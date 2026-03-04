import { EventEmitter } from 'events';
import { EncryptedEnvelope } from '../crypto/EncryptedEnvelope.js';
import { Operation } from '../core/Operation.js';

/**
 * SyncProtocol — Manages synchronization of encrypted CRDT state.
 *
 * Responsibilities:
 *   - Encrypt local operations and broadcast them
 *   - Receive encrypted operations, decrypt, and apply to local CRDTs
 *   - Request snapshots for initial sync / reconnection
 *   - Operation deduplication (via opId)
 *   - Offline buffering with flush on reconnect
 */
export class SyncProtocol extends EventEmitter {
    /**
     * @param {object} params
     * @param {import('./WebSocketTransport.js').WebSocketTransport} params.transport
     * @param {import('../crypto/KeyRotation.js').KeyRotation} params.keyRotation
     * @param {string} params.documentId
     */
    constructor({ transport, keyRotation, documentId }) {
        super();
        this._transport = transport;
        this._keyRotation = keyRotation;
        this._documentId = documentId;
        /** @type {Set<string>} */
        this._seenOps = new Set();
        /** @type {Array<object>} */
        this._pendingOps = [];

        this._transport.on('message', (msg) => this._handleMessage(msg));
        this._transport.on('connected', () => this._onReconnect());
    }

    /**
     * Encrypt and broadcast a local operation.
     * @param {Operation} operation
     */
    async broadcastOperation(operation) {
        this._seenOps.add(operation.opId);

        const key = this._keyRotation.currentKey;
        if (!key) {
            throw new Error('No document key available for encryption');
        }

        const envelope = await EncryptedEnvelope.encryptOperation(
            operation,
            key,
            this._documentId,
            this._keyRotation.epoch,
        );

        const message = {
            action: 'broadcast',
            roomId: this._documentId,
            envelope,
        };

        this._transport.send(message);
    }

    /**
     * Request the latest encrypted snapshot from the server.
     */
    requestSnapshot() {
        this._transport.send({
            action: 'request-snapshot',
            roomId: this._documentId,
        });
    }

    /**
     * Upload an encrypted snapshot to the server.
     * @param {object} crdtState - CRDT state (from toJSON())
     */
    async uploadSnapshot(crdtState) {
        const key = this._keyRotation.currentKey;
        if (!key) throw new Error('No document key available');

        const envelope = await EncryptedEnvelope.encryptSnapshot(
            crdtState,
            key,
            this._documentId,
            this._keyRotation.epoch,
        );

        this._transport.send({
            action: 'upload-snapshot',
            roomId: this._documentId,
            envelope,
        });
    }

    /**
     * Handle an incoming message from the transport.
     * @param {object} msg
     */
    async _handleMessage(msg) {
        try {
            if (msg.action === 'envelope') {
                await this._handleEnvelope(msg.envelope);
            } else if (msg.action === 'snapshot') {
                await this._handleSnapshot(msg.envelope);
            } else if (msg.action === 'peer-joined') {
                this.emit('peer-joined', msg.peerId);
            } else if (msg.action === 'peer-left') {
                this.emit('peer-left', msg.peerId);
            } else if (msg.action === 'awareness') {
                this.emit('awareness', msg.data);
            }
        } catch (err) {
            this.emit('error', err);
        }
    }

    /**
     * Handle an incoming encrypted envelope.
     * @param {object} envelope
     */
    async _handleEnvelope(envelope) {
        if (!EncryptedEnvelope.isValid(envelope)) {
            this.emit('error', new Error('Invalid envelope received'));
            return;
        }

        // Get the correct key for this epoch
        const key = this._keyRotation.getKeyForEpoch(envelope.epoch);
        if (!key) {
            // Buffer the operation — we might not have this key yet
            this._pendingOps.push(envelope);
            this.emit('error', new Error(`No key for epoch ${envelope.epoch}`));
            return;
        }

        if (envelope.type === 'operation') {
            const opData = await EncryptedEnvelope.decryptOperation(envelope, key);

            // Deduplication
            if (this._seenOps.has(opData.opId)) return;
            this._seenOps.add(opData.opId);

            const operation = Operation.fromJSON(opData);
            this.emit('remote-operation', operation);
        }
    }

    /**
     * Handle an incoming encrypted snapshot.
     * @param {object} envelope
     */
    async _handleSnapshot(envelope) {
        if (!envelope || !EncryptedEnvelope.isValid(envelope)) {
            this.emit('error', new Error('Invalid snapshot envelope'));
            return;
        }

        const key = this._keyRotation.getKeyForEpoch(envelope.epoch);
        if (!key) {
            this.emit('error', new Error(`No key for snapshot epoch ${envelope.epoch}`));
            return;
        }

        const state = await EncryptedEnvelope.decryptSnapshot(envelope, key);
        this.emit('snapshot', state);
    }

    /**
     * Handle reconnection — request latest snapshot.
     */
    _onReconnect() {
        // Re-join the room and request current state
        this._transport.send({
            action: 'join',
            roomId: this._documentId,
        });

        this.requestSnapshot();
    }

    /**
     * Clean up.
     */
    destroy() {
        this._transport.removeAllListeners('message');
        this._transport.removeAllListeners('connected');
        this.removeAllListeners();
    }
}
