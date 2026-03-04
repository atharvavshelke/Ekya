import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { RoomManager } from './RoomManager.js';
import { SnapshotStore } from './SnapshotStore.js';

/**
 * RelayServer — Trustless encrypted message relay.
 *
 * Core principle: The server is intentionally DUMB.
 * It forwards encrypted envelopes between clients but NEVER decrypts them.
 * It has ZERO knowledge of document contents.
 *
 * Responsibilities:
 *   - Room management (join/leave)
 *   - Encrypted envelope relay (broadcast to room)
 *   - WebRTC signaling relay (SDP/ICE forwarding)
 *   - Encrypted snapshot storage (opaque blobs)
 *   - Awareness relay (cursor/presence forwarding)
 */
export class RelayServer {
    /**
     * @param {object} [options={}]
     * @param {number} [options.port=4444]
     * @param {boolean} [options.verbose=false]
     * @param {import('http').Server} [options.server] - Existing HTTP server to attach to
     */
    constructor(options = {}) {
        this._port = options.port || 4444;
        this._verbose = options.verbose || false;
        this._httpServer = options.server || null;
        this._wss = null;
        this._rooms = new RoomManager();
        this._snapshots = new SnapshotStore();
        /** @type {Map<string, import('ws').WebSocket>} clientId → ws */
        this._clients = new Map();

        // If an existing server is provided, attach immediately
        if (this._httpServer) {
            this._attachToServer(this._httpServer);
        }
    }

    /**
     * Attach WebSocket server to an existing HTTP server.
     * @param {import('http').Server} server
     */
    _attachToServer(server) {
        this._wss = new WebSocketServer({ server });
        this._setupWSS();
    }

    /**
     * Set up WebSocket server event handlers.
     */
    _setupWSS() {
        this._wss.on('connection', (ws) => {
            const clientId = uuidv4();
            this._clients.set(clientId, ws);

            this._log(`Client connected: ${clientId}`);

            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    this._handleMessage(clientId, ws, msg);
                } catch (err) {
                    this._log(`Parse error from ${clientId}: ${err.message}`);
                }
            });

            ws.on('close', () => {
                this._handleDisconnect(clientId);
            });

            ws.on('error', (err) => {
                this._log(`Error from ${clientId}: ${err.message}`);
            });

            // Send the client their ID
            ws.send(JSON.stringify({ action: 'welcome', clientId }));
        });
    }

    /**
     * Start the relay server (standalone mode — creates its own port).
     * @returns {Promise<void>}
     */
    start() {
        return new Promise((resolve) => {
            this._wss = new WebSocketServer({ port: this._port });
            this._setupWSS();

            this._wss.on('listening', () => {
                this._log(`Ekya relay server listening on port ${this._port}`);
                resolve();
            });
        });
    }

    /**
     * Handle an incoming message from a client.
     * @param {string} clientId
     * @param {import('ws').WebSocket} ws
     * @param {object} msg
     */
    _handleMessage(clientId, ws, msg) {
        switch (msg.action) {
            case 'join':
                this._handleJoin(clientId, msg);
                break;

            case 'leave':
                this._handleLeave(clientId);
                break;

            case 'broadcast':
                this._handleBroadcast(clientId, msg);
                break;

            case 'upload-snapshot':
                this._handleUploadSnapshot(clientId, msg);
                break;

            case 'request-snapshot':
                this._handleRequestSnapshot(clientId, msg);
                break;

            case 'awareness-broadcast':
                this._handleAwarenessBroadcast(clientId, msg);
                break;

            // WebRTC signaling
            case 'signal-offer':
            case 'signal-answer':
            case 'signal-candidate':
                this._handleSignaling(clientId, msg);
                break;

            default:
                this._log(`Unknown action from ${clientId}: ${msg.action}`);
        }
    }

    /**
     * Handle a client joining a room.
     * @param {string} clientId
     * @param {object} msg - { action: 'join', roomId }
     */
    _handleJoin(clientId, msg) {
        const { roomId } = msg;
        const isNew = this._rooms.join(roomId, clientId);

        if (isNew) {
            this._log(`${clientId} joined room ${roomId}`);

            // Notify existing room members
            this._broadcastToRoom(roomId, clientId, {
                action: 'peer-joined',
                peerId: clientId,
                roomSize: this._rooms.getRoomSize(roomId),
            });
        }
    }

    /**
     * Handle a client leaving.
     * @param {string} clientId
     */
    _handleLeave(clientId) {
        const result = this._rooms.leave(clientId);
        if (result) {
            this._log(`${clientId} left room ${result.roomId}`);
            this._broadcastToRoom(result.roomId, clientId, {
                action: 'peer-left',
                peerId: clientId,
                roomSize: result.remaining,
            });
        }
    }

    /**
     * Handle client disconnect.
     * @param {string} clientId
     */
    _handleDisconnect(clientId) {
        this._handleLeave(clientId);
        this._clients.delete(clientId);
        this._log(`Client disconnected: ${clientId}`);
    }

    /**
     * Handle encrypted envelope broadcast.
     * The server forwards the opaque envelope WITHOUT looking inside.
     * @param {string} clientId
     * @param {object} msg
     */
    _handleBroadcast(clientId, msg) {
        const { roomId, envelope } = msg;

        // Log only envelope metadata — NEVER the ciphertext content
        this._log(
            `Relay: ${clientId} → room ${roomId} | type=${envelope?.type} epoch=${envelope?.epoch} | ${envelope?.ciphertext?.length || 0} chars encrypted`,
        );

        this._broadcastToRoom(roomId, clientId, {
            action: 'envelope',
            envelope,
            senderId: clientId,
        });
    }

    /**
     * Handle encrypted snapshot upload.
     * @param {string} clientId
     * @param {object} msg
     */
    _handleUploadSnapshot(clientId, msg) {
        const { roomId, envelope } = msg;
        this._snapshots.save(roomId, envelope);
        this._log(`Snapshot saved for room ${roomId} (epoch ${envelope?.epoch})`);
    }

    /**
     * Handle snapshot request — send the latest encrypted snapshot.
     * @param {string} clientId
     * @param {object} msg
     */
    _handleRequestSnapshot(clientId, msg) {
        const { roomId } = msg;
        const snapshot = this._snapshots.load(roomId);

        const ws = this._clients.get(clientId);
        if (ws && ws.readyState === 1) {
            ws.send(
                JSON.stringify({
                    action: 'snapshot',
                    roomId,
                    envelope: snapshot, // null if no snapshot exists
                }),
            );
        }
    }

    /**
     * Handle awareness (cursor/presence) broadcast.
     * @param {string} clientId
     * @param {object} msg
     */
    _handleAwarenessBroadcast(clientId, msg) {
        const { roomId, data } = msg;
        this._broadcastToRoom(roomId, clientId, {
            action: 'awareness',
            data,
            senderId: clientId,
        });
    }

    /**
     * Handle WebRTC signaling relay.
     * @param {string} clientId
     * @param {object} msg
     */
    _handleSignaling(clientId, msg) {
        const { targetId, ...rest } = msg;
        const targetWs = this._clients.get(targetId);

        if (targetWs && targetWs.readyState === 1) {
            targetWs.send(JSON.stringify({ ...rest, senderId: clientId }));
            this._log(`Signal relay: ${clientId} → ${targetId} (${msg.action})`);
        }
    }

    /**
     * Broadcast a message to all clients in a room except the sender.
     * @param {string} roomId
     * @param {string} excludeClientId
     * @param {object} message
     */
    _broadcastToRoom(roomId, excludeClientId, message) {
        const clients = this._rooms.getClients(roomId);
        const payload = JSON.stringify(message);

        for (const cid of clients) {
            if (cid === excludeClientId) continue;
            const ws = this._clients.get(cid);
            if (ws && ws.readyState === 1) {
                ws.send(payload);
            }
        }
    }

    /**
     * Log a message (if verbose mode is on).
     * @param {string} msg
     */
    _log(msg) {
        if (this._verbose) {
            console.log(`[Ekya Relay] ${new Date().toISOString()} ${msg}`);
        }
    }

    /**
     * Stop the relay server.
     * @returns {Promise<void>}
     */
    stop() {
        return new Promise((resolve) => {
            if (this._wss) {
                // Close all client connections
                for (const [, ws] of this._clients) {
                    ws.close();
                }
                this._clients.clear();
                this._wss.close(() => resolve());
            } else {
                resolve();
            }
        });
    }

    /**
     * Get server stats.
     * @returns {object}
     */
    stats() {
        return {
            clients: this._clients.size,
            rooms: this._rooms.getRooms().length,
            snapshots: this._snapshots.size,
        };
    }
}

// Allow running as standalone
const isMain =
    typeof process !== 'undefined' &&
    process.argv[1] &&
    (process.argv[1].endsWith('RelayServer.js') || process.argv[1].endsWith('RelayServer'));

if (isMain) {
    const port = parseInt(process.env.PORT || '4444', 10);
    const server = new RelayServer({ port, verbose: true });
    server.start().then(() => {
        console.log(`\n  🔐 Ekya Relay Server`);
        console.log(`  ────────────────────`);
        console.log(`  Listening on port ${port}`);
        console.log(`  Trustless mode: The server NEVER sees plaintext data.`);
        console.log(`  All payloads are encrypted opaque blobs.\n`);
    });
}
