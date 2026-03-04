import { EventEmitter } from 'events';

/**
 * HybridTransport — Relay-first with automatic P2P upgrade.
 *
 * Strategy:
 *   1. Start with WebSocket relay (always-available, works behind NATs)
 *   2. After joining a room and discovering peers, attempt WebRTC P2P
 *   3. Once P2P channel opens, route messages through data channel
 *   4. If P2P connection fails or drops, fall back to relay transparently
 *
 * The caller doesn't need to know which transport is being used.
 * Messages always get through — the transport handles the routing.
 *
 * @example
 * ```js
 * const transport = new HybridTransport({
 *   nodeId: 'alice',
 *   wsTransport,
 *   rtcTransport,
 * });
 *
 * // Send automatically uses best available channel
 * transport.send(message);       // Via relay OR P2P
 * transport.sendDirect(message); // Force P2P only
 * transport.sendRelay(message);  // Force relay only
 * ```
 */
export class HybridTransport extends EventEmitter {
    /**
     * @param {object} params
     * @param {string} params.nodeId
     * @param {import('./WebSocketTransport.js').WebSocketTransport} params.wsTransport
     * @param {import('./WebRTCTransport.js').WebRTCTransport} [params.rtcTransport]
     * @param {boolean} [params.preferP2P=true] - Prefer P2P when available
     * @param {boolean} [params.autoUpgrade=true] - Auto-upgrade to P2P when peers join
     */
    constructor({ nodeId, wsTransport, rtcTransport, preferP2P = true, autoUpgrade = true }) {
        super();
        this.nodeId = nodeId;
        this._ws = wsTransport;
        this._rtc = rtcTransport || null;
        this._preferP2P = preferP2P;
        this._autoUpgrade = autoUpgrade;

        /** @type {Map<string, 'relay'|'p2p'>} peerId → active transport */
        this._peerRoutes = new Map();

        this._wireRelayEvents();
        if (this._rtc) {
            this._wireP2PEvents();
        }
    }

    /**
     * Wire relay (WebSocket) events.
     */
    _wireRelayEvents() {
        this._ws.on('message', (msg) => {
            // If this is an envelope from a peer we have P2P with, ignore relay copy
            if (msg.action === 'envelope' && msg.senderId) {
                if (this._peerRoutes.get(msg.senderId) === 'p2p') {
                    return; // Already receiving via P2P
                }
            }

            this.emit('message', msg, 'relay');
        });

        this._ws.on('connected', () => this.emit('connected'));
        this._ws.on('disconnected', () => this.emit('disconnected'));
    }

    /**
     * Wire P2P (WebRTC) events.
     */
    _wireP2PEvents() {
        this._rtc.on('message', (msg, peerId) => {
            this._peerRoutes.set(peerId, 'p2p');
            this.emit('message', msg, 'p2p');
        });

        this._rtc.on('channel-open', (peerId) => {
            this._peerRoutes.set(peerId, 'p2p');
            this.emit('p2p-connected', peerId);
        });

        this._rtc.on('peer-disconnected', (peerId) => {
            this._peerRoutes.set(peerId, 'relay');
            this.emit('p2p-disconnected', peerId);
        });

        // Auto-upgrade: when a new peer joins via relay, try P2P
        if (this._autoUpgrade) {
            this._ws.on('message', (msg) => {
                if (msg.action === 'peer-joined' && msg.peerId) {
                    this._attemptP2PUpgrade(msg.peerId);
                }
            });
        }
    }

    /**
     * Attempt to upgrade a peer connection to P2P.
     * @param {string} peerId
     */
    async _attemptP2PUpgrade(peerId) {
        if (!this._rtc) return;
        if (this._rtc.isConnectedTo(peerId)) return;

        try {
            // Only the alphabetically-lower nodeId initiates (prevent double-connecting)
            if (this.nodeId < peerId) {
                await this._rtc.connect(peerId);
            }
        } catch (e) {
            // P2P failed — stay on relay
            this._peerRoutes.set(peerId, 'relay');
        }
    }

    /**
     * Send a message using the best available transport.
     * Prefers P2P if available and configured, falls back to relay.
     * @param {object} message
     * @returns {'p2p'|'relay'} — which transport was used
     */
    send(message) {
        // If we prefer P2P and have connected peers, broadcast via P2P
        if (this._preferP2P && this._rtc) {
            const p2pSent = this._rtc.broadcast(message);
            if (p2pSent > 0) {
                // Also send via relay for peers we DON'T have P2P with
                this._ws.send(message);
                return 'p2p';
            }
        }

        // Fall back to relay
        this._ws.send(message);
        return 'relay';
    }

    /**
     * Force send via P2P only.
     * @param {object} message
     * @returns {number} Number of peers reached
     */
    sendDirect(message) {
        if (!this._rtc) return 0;
        return this._rtc.broadcast(message);
    }

    /**
     * Force send via relay only.
     * @param {object} message
     */
    sendRelay(message) {
        this._ws.send(message);
    }

    /**
     * Get the current transport stats.
     * @returns {{ relayConnected: boolean, p2pPeers: number, routes: Record<string, string> }}
     */
    stats() {
        return {
            relayConnected: this._ws.connected || false,
            p2pPeers: this._rtc ? this._rtc.connectedPeers.length : 0,
            routes: Object.fromEntries(this._peerRoutes),
        };
    }

    /**
     * Disconnect everything.
     */
    disconnect() {
        if (this._rtc) this._rtc.disconnectAll();
        this._ws.disconnect();
        this._peerRoutes.clear();
    }
}
