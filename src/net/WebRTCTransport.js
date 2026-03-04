import { EventEmitter } from 'events';

/**
 * WebRTCTransport — Direct peer-to-peer data channel transport.
 *
 * Uses WebRTC RTCPeerConnection with RTCDataChannel for direct
 * encrypted communication between peers, bypassing the relay server.
 *
 * Signaling (SDP/ICE exchange) still goes through the relay server,
 * but once the P2P connection is established, all data flows directly.
 *
 * This is the "upgrade path" — peers start on WebSocket relay,
 * then upgrade to direct P2P when both sides are ready.
 *
 * @example
 * ```js
 * const rtc = new WebRTCTransport({ nodeId: 'alice', signalingTransport: wsTransport });
 * await rtc.connect('bob');   // Initiate P2P to bob
 * rtc.send({ action: 'envelope', envelope: { ... } });
 * rtc.on('message', (msg) => console.log('Direct from peer:', msg));
 * ```
 */
export class WebRTCTransport extends EventEmitter {
    /**
     * @param {object} params
     * @param {string} params.nodeId - Local node identifier
     * @param {import('./WebSocketTransport.js').WebSocketTransport} params.signalingTransport - Relay for SDP/ICE
     * @param {RTCConfiguration} [params.rtcConfig] - ICE server configuration
     */
    constructor({ nodeId, signalingTransport, rtcConfig }) {
        super();
        this.nodeId = nodeId;
        this._signaling = signalingTransport;

        /** @type {RTCConfiguration} */
        this._rtcConfig = rtcConfig || {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
            ],
        };

        /** @type {Map<string, RTCPeerConnection>} peerId → connection */
        this._peers = new Map();
        /** @type {Map<string, RTCDataChannel>} peerId → data channel */
        this._channels = new Map();
        /** @type {Map<string, Array>} peerId → pending messages */
        this._pendingMessages = new Map();

        this._setupSignalingListeners();
    }

    /**
     * Listen for signaling messages from the relay server.
     */
    _setupSignalingListeners() {
        this._signaling.on('message', (msg) => {
            switch (msg.action) {
                case 'signal-offer':
                    this._handleOffer(msg.senderId, msg.sdp);
                    break;
                case 'signal-answer':
                    this._handleAnswer(msg.senderId, msg.sdp);
                    break;
                case 'signal-candidate':
                    this._handleCandidate(msg.senderId, msg.candidate);
                    break;
            }
        });
    }

    /**
     * Initiate a P2P connection to a specific peer.
     * @param {string} peerId - Target peer ID
     * @returns {Promise<void>}
     */
    async connect(peerId) {
        const pc = this._createPeerConnection(peerId);
        this._peers.set(peerId, pc);

        // Create data channel (initiator side)
        const channel = pc.createDataChannel('ekya-data', {
            ordered: true,
            maxRetransmits: 10,
        });
        this._setupChannel(peerId, channel);

        // Create and send offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        this._signaling.send({
            action: 'signal-offer',
            targetId: peerId,
            sdp: pc.localDescription,
        });

        this.emit('connecting', peerId);
    }

    /**
     * Create an RTCPeerConnection for a specific peer.
     * @param {string} peerId
     * @returns {RTCPeerConnection}
     */
    _createPeerConnection(peerId) {
        const pc = new RTCPeerConnection(this._rtcConfig);

        // ICE candidate handling
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this._signaling.send({
                    action: 'signal-candidate',
                    targetId: peerId,
                    candidate: event.candidate,
                });
            }
        };

        // Connection state changes
        pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            if (state === 'connected') {
                this.emit('peer-connected', peerId);
            } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
                this._cleanupPeer(peerId);
                this.emit('peer-disconnected', peerId);
            }
        };

        // Incoming data channel (answerer side)
        pc.ondatachannel = (event) => {
            this._setupChannel(peerId, event.channel);
        };

        return pc;
    }

    /**
     * Set up a data channel for a peer.
     * @param {string} peerId
     * @param {RTCDataChannel} channel
     */
    _setupChannel(peerId, channel) {
        channel.onopen = () => {
            this._channels.set(peerId, channel);
            this.emit('channel-open', peerId);

            // Flush pending messages
            const pending = this._pendingMessages.get(peerId);
            if (pending) {
                for (const msg of pending) {
                    channel.send(JSON.stringify(msg));
                }
                this._pendingMessages.delete(peerId);
            }
        };

        channel.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                this.emit('message', msg, peerId);
            } catch (e) {
                // Binary or unparseable message
                this.emit('data', event.data, peerId);
            }
        };

        channel.onclose = () => {
            this._channels.delete(peerId);
            this.emit('channel-closed', peerId);
        };

        channel.onerror = (error) => {
            this.emit('error', error, peerId);
        };
    }

    /**
     * Handle an incoming SDP offer (answerer side).
     * @param {string} peerId
     * @param {RTCSessionDescriptionInit} sdp
     */
    async _handleOffer(peerId, sdp) {
        const pc = this._createPeerConnection(peerId);
        this._peers.set(peerId, pc);

        await pc.setRemoteDescription(sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        this._signaling.send({
            action: 'signal-answer',
            targetId: peerId,
            sdp: pc.localDescription,
        });
    }

    /**
     * Handle an incoming SDP answer.
     * @param {string} peerId
     * @param {RTCSessionDescriptionInit} sdp
     */
    async _handleAnswer(peerId, sdp) {
        const pc = this._peers.get(peerId);
        if (pc) {
            await pc.setRemoteDescription(sdp);
        }
    }

    /**
     * Handle an incoming ICE candidate.
     * @param {string} peerId
     * @param {RTCIceCandidateInit} candidate
     */
    async _handleCandidate(peerId, candidate) {
        const pc = this._peers.get(peerId);
        if (pc) {
            await pc.addIceCandidate(candidate);
        }
    }

    /**
     * Send a message to a specific peer via P2P data channel.
     * If the channel isn't open yet, buffers the message.
     * @param {string} peerId
     * @param {object} message
     * @returns {boolean} true if sent immediately, false if buffered
     */
    sendToPeer(peerId, message) {
        const channel = this._channels.get(peerId);

        if (channel && channel.readyState === 'open') {
            channel.send(JSON.stringify(message));
            return true;
        }

        // Buffer for later
        if (!this._pendingMessages.has(peerId)) {
            this._pendingMessages.set(peerId, []);
        }
        this._pendingMessages.get(peerId).push(message);
        return false;
    }

    /**
     * Broadcast a message to ALL connected peers via P2P.
     * @param {object} message
     * @returns {number} Number of peers the message was sent to
     */
    broadcast(message) {
        const payload = JSON.stringify(message);
        let sent = 0;

        for (const [peerId, channel] of this._channels) {
            if (channel.readyState === 'open') {
                channel.send(payload);
                sent++;
            }
        }

        return sent;
    }

    /**
     * Check if we have a direct P2P channel to a peer.
     * @param {string} peerId
     * @returns {boolean}
     */
    isConnectedTo(peerId) {
        const channel = this._channels.get(peerId);
        return channel !== undefined && channel.readyState === 'open';
    }

    /**
     * Get all connected peer IDs.
     * @returns {string[]}
     */
    get connectedPeers() {
        return [...this._channels.entries()]
            .filter(([, ch]) => ch.readyState === 'open')
            .map(([id]) => id);
    }

    /**
     * Get connection stats for a peer.
     * @param {string} peerId
     * @returns {Promise<RTCStatsReport|null>}
     */
    async getStats(peerId) {
        const pc = this._peers.get(peerId);
        if (!pc) return null;
        return await pc.getStats();
    }

    /**
     * Disconnect from a specific peer.
     * @param {string} peerId
     */
    disconnectPeer(peerId) {
        this._cleanupPeer(peerId);
    }

    /**
     * Disconnect from all peers.
     */
    disconnectAll() {
        for (const peerId of this._peers.keys()) {
            this._cleanupPeer(peerId);
        }
    }

    /**
     * Clean up resources for a peer.
     * @param {string} peerId
     */
    _cleanupPeer(peerId) {
        const channel = this._channels.get(peerId);
        if (channel) {
            channel.close();
            this._channels.delete(peerId);
        }

        const pc = this._peers.get(peerId);
        if (pc) {
            pc.close();
            this._peers.delete(peerId);
        }

        this._pendingMessages.delete(peerId);
    }

    /**
     * Destroy the transport entirely.
     */
    destroy() {
        this.disconnectAll();
        this.removeAllListeners();
    }
}
