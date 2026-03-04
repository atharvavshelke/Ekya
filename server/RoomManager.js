/**
 * RoomManager — Manages rooms and their connected clients.
 *
 * Pure state management — no crypto, no decryption.
 * Tracks which clients are in which rooms.
 */
export class RoomManager {
    constructor() {
        /** @type {Map<string, Set<string>>} roomId → Set of clientIds */
        this._rooms = new Map();
        /** @type {Map<string, string>} clientId → roomId */
        this._clientRooms = new Map();
    }

    /**
     * Add a client to a room.
     * @param {string} roomId
     * @param {string} clientId
     * @returns {boolean} true if newly joined (not already in room)
     */
    join(roomId, clientId) {
        if (!this._rooms.has(roomId)) {
            this._rooms.set(roomId, new Set());
        }

        const room = this._rooms.get(roomId);
        if (room.has(clientId)) return false;

        room.add(clientId);
        this._clientRooms.set(clientId, roomId);
        return true;
    }

    /**
     * Remove a client from their room.
     * @param {string} clientId
     * @returns {{roomId: string, remaining: number}|null}
     */
    leave(clientId) {
        const roomId = this._clientRooms.get(clientId);
        if (!roomId) return null;

        const room = this._rooms.get(roomId);
        if (room) {
            room.delete(clientId);
            if (room.size === 0) {
                this._rooms.delete(roomId);
            }
        }

        this._clientRooms.delete(clientId);
        return { roomId, remaining: room ? room.size : 0 };
    }

    /**
     * Get all client IDs in a room.
     * @param {string} roomId
     * @returns {string[]}
     */
    getClients(roomId) {
        const room = this._rooms.get(roomId);
        return room ? [...room] : [];
    }

    /**
     * Get the room a client is in.
     * @param {string} clientId
     * @returns {string|undefined}
     */
    getRoom(clientId) {
        return this._clientRooms.get(clientId);
    }

    /**
     * Get all active room IDs.
     * @returns {string[]}
     */
    getRooms() {
        return [...this._rooms.keys()];
    }

    /**
     * Get room size.
     * @param {string} roomId
     * @returns {number}
     */
    getRoomSize(roomId) {
        const room = this._rooms.get(roomId);
        return room ? room.size : 0;
    }
}
