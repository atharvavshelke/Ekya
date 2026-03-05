import { EventEmitter } from 'events';
import { WebSocketTransport } from './net/WebSocketTransport.js';
import { SyncProtocol } from './net/SyncProtocol.js';
import { AwarenessProtocol } from './net/AwarenessProtocol.js';
import { KeyManager } from './crypto/KeyManager.js';
import { KeyRotation } from './crypto/KeyRotation.js';

/**
 * EkyaProvider — Manages network, encryption, and sync for documents.
 *
 * Connects EkyaDocuments to the relay server. Handles:
 *   - Transport management (WebSocket connection)
 *   - Encryption/decryption pipeline (via SyncProtocol)
 *   - Awareness (cursor/presence via AwarenessProtocol)
 *   - Key management and rotation
 *
 * @example
 * ```js
 * const doc = new EkyaDocument({ id: 'my-doc', type: 'text', nodeId: 'alice' });
 * const key = await KeyManager.generateDocumentKey();
 *
 * const provider = new EkyaProvider({
 *   signalingUrl: 'ws://localhost:4444',
 *   documentKey: key,
 *   nodeId: 'alice',
 * });
 *
 * await provider.connect(doc);
 * provider.awareness.setLocalState({ cursor: 42, user: 'Alice' });
 * ```
 */
export class EkyaProvider extends EventEmitter {
    /**
     * @param {object} params
     * @param {string} params.signalingUrl - Relay server WebSocket URL
     * @param {CryptoKey} params.documentKey - AES-256-GCM document key
     * @param {string} params.nodeId - Local node/user identifier
     * @param {number} [params.keyEpoch=0] - Initial key epoch
     */
    constructor({ signalingUrl, documentKey, nodeId, keyEpoch = 0 }) {
        super();
        this._signalingUrl = signalingUrl;
        this._nodeId = nodeId;
        this._transport = new WebSocketTransport();

        // Key rotation
        this._keyRotation = new KeyRotation(documentKey);
        if (keyEpoch > 0) {
            this._keyRotation.setKey(documentKey, keyEpoch);
        }

        /** @type {import('./EkyaDocument.js').EkyaDocument|null} */
        this._document = null;
        /** @type {SyncProtocol|null} */
        this._syncProtocol = null;
        /** @type {AwarenessProtocol|null} */
        this.awareness = null;

        this._connected = false;
    }

    /**
     * Connect a document to the relay server and start syncing.
     * @param {import('./EkyaDocument.js').EkyaDocument} document
     * @returns {Promise<void>}
     */
    async connect(document) {
        this._document = document;

        // Set up sync protocol
        this._syncProtocol = new SyncProtocol({
            transport: this._transport,
            keyRotation: this._keyRotation,
            documentId: document.id,
        });

        // Set up awareness
        this.awareness = new AwarenessProtocol({
            transport: this._transport,
            documentId: document.id,
            nodeId: this._nodeId,
        });

        // Wire document operations → sync protocol (encrypt & broadcast)
        document.on('operation', async (op) => {
            try {
                await this._syncProtocol.broadcastOperation(op);
            } catch (err) {
                this.emit('error', err);
            }
        });

        // Wire sync protocol → document (decrypt & apply)
        this._syncProtocol.on('remote-operation', (op) => {
            document.applyRemoteOperation(op);
        });

        // Wire snapshots
        this._syncProtocol.on('snapshot', (state) => {
            if (state) {
                document.loadSnapshot(state);
                this.emit('synced');
            }
        });

        // Wire peer events
        this._syncProtocol.on('peer-joined', (peerId) => this.emit('peer-joined', peerId));
        this._syncProtocol.on('peer-left', (peerId) => this.emit('peer-left', peerId));

        // Key rotation → snapshot upload
        this._keyRotation.onRotation(async () => {
            if (this._document) {
                await this._syncProtocol.uploadSnapshot(this._document.getSnapshot());
            }
        });

        // Connect transport
        await this._transport.connect(this._signalingUrl);
        this._connected = true;

        // Phase 4: Generate room auth token
        const currentKey = this._keyRotation.getCurrentKey();
        const authToken = await KeyManager.generateRoomAuthToken(document.id, currentKey);

        // Join the room securely
        this._transport.send({
            action: 'join',
            roomId: document.id,
            authToken,
        });

        // Request latest snapshot
        this._syncProtocol.requestSnapshot();

        this.emit('connected');
    }

    /**
     * Disconnect from the relay server.
     */
    disconnect() {
        if (this._syncProtocol) {
            this._syncProtocol.destroy();
            this._syncProtocol = null;
        }
        if (this.awareness) {
            this.awareness.destroy();
            this.awareness = null;
        }
        this._transport.disconnect();
        this._connected = false;
        this._document = null;
        this.emit('disconnected');
    }

    /**
     * Rotate the document encryption key.
     * Generates a new key and uploads a fresh encrypted snapshot.
     * @returns {Promise<{key: CryptoKey, epoch: number}>}
     */
    async rotateKey() {
        return await this._keyRotation.rotateKey();
    }

    /**
     * Get the current key epoch.
     * @returns {number}
     */
    get epoch() {
        return this._keyRotation.epoch;
    }

    /**
     * Whether the provider is connected.
     * @returns {boolean}
     */
    get connected() {
        return this._connected;
    }
}
