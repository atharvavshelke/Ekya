import { EventEmitter } from 'events';

/**
 * AwarenessProtocol — Presence and cursor awareness.
 *
 * Broadcasts local state (cursor position, selection, user info) to all peers.
 * NOT encrypted — cursor metadata is intentional public information.
 *
 * Heartbeat mechanism detects disconnected peers (30s timeout).
 */
export class AwarenessProtocol extends EventEmitter {
    /**
     * @param {object} params
     * @param {import('./WebSocketTransport.js').WebSocketTransport} params.transport
     * @param {string} params.documentId
     * @param {string} params.nodeId
     * @param {number} [params.heartbeatInterval=15000] - ms between heartbeats
     * @param {number} [params.timeout=30000] - ms before a peer is considered offline
     */
    constructor({ transport, documentId, nodeId, heartbeatInterval = 15000, timeout = 30000 }) {
        super();
        this._transport = transport;
        this._documentId = documentId;
        this._nodeId = nodeId;
        this._heartbeatInterval = heartbeatInterval;
        this._timeout = timeout;

        /** @type {object|null} */
        this._localState = null;

        /** @type {Map<string, {state: object, lastSeen: number}>} */
        this._remoteStates = new Map();

        this._heartbeatTimer = null;
        this._cleanupTimer = null;

        this._transport.on('message', (msg) => {
            if (msg.action === 'awareness') this._handleRemoteAwareness(msg);
        });

        this._startHeartbeat();
        this._startCleanup();
    }

    /**
     * Set and broadcast local awareness state.
     * @param {object} state - { cursor, selection, user, color, ... }
     */
    setLocalState(state) {
        this._localState = { ...state, nodeId: this._nodeId };
        this._broadcastLocal();
    }

    /**
     * Get the local awareness state.
     * @returns {object|null}
     */
    getLocalState() {
        return this._localState;
    }

    /**
     * Get all remote peer states.
     * @returns {Map<string, object>}
     */
    getStates() {
        const result = new Map();
        for (const [nodeId, { state }] of this._remoteStates) {
            result.set(nodeId, state);
        }
        return result;
    }

    /**
     * Broadcast local awareness state.
     */
    _broadcastLocal() {
        if (!this._localState) return;

        this._transport.send({
            action: 'awareness-broadcast',
            roomId: this._documentId,
            data: {
                nodeId: this._nodeId,
                state: this._localState,
                timestamp: Date.now(),
            },
        });
    }

    /**
     * Handle incoming remote awareness data.
     * @param {object} msg
     */
    _handleRemoteAwareness(msg) {
        const { nodeId, state, timestamp } = msg.data;
        if (nodeId === this._nodeId) return; // Ignore own awareness

        const existing = this._remoteStates.get(nodeId);
        this._remoteStates.set(nodeId, { state, lastSeen: timestamp || Date.now() });

        if (!existing) {
            this.emit('join', { nodeId, state });
        }
        this.emit('update', { nodeId, state });
    }

    /**
     * Start periodic heartbeat broadcasts.
     */
    _startHeartbeat() {
        this._heartbeatTimer = setInterval(() => {
            this._broadcastLocal();
        }, this._heartbeatInterval);
    }

    /**
     * Start periodic cleanup of stale peers.
     */
    _startCleanup() {
        this._cleanupTimer = setInterval(() => {
            const now = Date.now();
            for (const [nodeId, { lastSeen }] of this._remoteStates) {
                if (now - lastSeen > this._timeout) {
                    this._remoteStates.delete(nodeId);
                    this.emit('leave', { nodeId });
                }
            }
        }, this._timeout / 2);
    }

    /**
     * Clean up timers and listeners.
     */
    destroy() {
        if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
        if (this._cleanupTimer) clearInterval(this._cleanupTimer);
        this.removeAllListeners();
    }
}
