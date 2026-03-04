/**
 * SnapshotStore — Persists encrypted snapshots.
 *
 * The server stores encrypted snapshots but CANNOT decrypt them.
 * This is pure opaque blob storage — the server has zero knowledge
 * of what's inside.
 *
 * Default: in-memory Map. Can be extended to file/database.
 */
export class SnapshotStore {
    constructor() {
        /** @type {Map<string, object>} roomId → encrypted snapshot envelope */
        this._snapshots = new Map();
    }

    /**
     * Save an encrypted snapshot for a room.
     * @param {string} roomId
     * @param {object} encryptedSnapshot - Opaque encrypted envelope
     */
    save(roomId, encryptedSnapshot) {
        this._snapshots.set(roomId, {
            ...encryptedSnapshot,
            storedAt: Date.now(),
        });
    }

    /**
     * Load the latest encrypted snapshot for a room.
     * @param {string} roomId
     * @returns {object|null}
     */
    load(roomId) {
        return this._snapshots.get(roomId) || null;
    }

    /**
     * Check if a snapshot exists.
     * @param {string} roomId
     * @returns {boolean}
     */
    has(roomId) {
        return this._snapshots.has(roomId);
    }

    /**
     * Delete a snapshot.
     * @param {string} roomId
     */
    delete(roomId) {
        this._snapshots.delete(roomId);
    }

    /**
     * Get the number of stored snapshots.
     * @returns {number}
     */
    get size() {
        return this._snapshots.size;
    }
}
