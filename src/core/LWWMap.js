import { VectorClock } from './VectorClock.js';
import { Operation } from './Operation.js';

/**
 * LWWMap — Map composed of LWW-Registers.
 *
 * Each key maps to a value with a timestamp. Concurrent writes to the same
 * key are resolved by Last-Writer-Wins (timestamp, then nodeId tie-break).
 * Deletion uses tombstones — a key is marked deleted with a timestamp,
 * and can only be overridden by a later write.
 *
 * Ideal for structured key-value documents, shared configuration, etc.
 */
export class LWWMap {
    /**
     * @param {string} id - Unique identifier for this CRDT instance
     * @param {string} nodeId - ID of the local node
     */
    constructor(id, nodeId) {
        this.id = id;
        this.nodeId = nodeId;
        /**
         * Internal store: key → { value, timestamp, writerNodeId, deleted }
         * @type {Map<string, {value: *, timestamp: number, writerNodeId: string, deleted: boolean}>}
         */
        this._entries = new Map();
        this.clock = new VectorClock();
        /** @type {Set<string>} */
        this._appliedOps = new Set();
    }

    /**
     * Set a key-value pair.
     * @param {string} key
     * @param {*} value
     * @returns {Operation}
     */
    set(key, value) {
        this.clock.increment(this.nodeId);
        const timestamp = Date.now();

        this._entries.set(key, {
            value,
            timestamp,
            writerNodeId: this.nodeId,
            deleted: false,
        });

        const op = new Operation({
            type: 'lwwmap:set',
            crdtId: this.id,
            nodeId: this.nodeId,
            clock: this.clock.get(this.nodeId),
            causalDeps: this.clock.toJSON(),
            data: { key, value, timestamp },
        });

        this._appliedOps.add(op.opId);
        return op;
    }

    /**
     * Delete a key (tombstone).
     * @param {string} key
     * @returns {Operation}
     */
    delete(key) {
        this.clock.increment(this.nodeId);
        const timestamp = Date.now();

        this._entries.set(key, {
            value: undefined,
            timestamp,
            writerNodeId: this.nodeId,
            deleted: true,
        });

        const op = new Operation({
            type: 'lwwmap:delete',
            crdtId: this.id,
            nodeId: this.nodeId,
            clock: this.clock.get(this.nodeId),
            causalDeps: this.clock.toJSON(),
            data: { key, timestamp },
        });

        this._appliedOps.add(op.opId);
        return op;
    }

    /**
     * Get the value for a key (returns undefined if deleted or missing).
     * @param {string} key
     * @returns {*}
     */
    get(key) {
        const entry = this._entries.get(key);
        if (!entry || entry.deleted) return undefined;
        return entry.value;
    }

    /**
     * Check if a key exists (not deleted).
     * @param {string} key
     * @returns {boolean}
     */
    has(key) {
        const entry = this._entries.get(key);
        return entry !== undefined && !entry.deleted;
    }

    /**
     * Get all non-deleted keys.
     * @returns {string[]}
     */
    keys() {
        const result = [];
        for (const [key, entry] of this._entries) {
            if (!entry.deleted) result.push(key);
        }
        return result;
    }

    /**
     * Apply a remote operation (with deduplication).
     * @param {Operation} op
     * @returns {boolean}
     */
    apply(op) {
        if (this._appliedOps.has(op.opId)) return false;

        if (op.type !== 'lwwmap:set' && op.type !== 'lwwmap:delete') {
            throw new Error(`LWWMap cannot apply operation of type: ${op.type}`);
        }

        this._appliedOps.add(op.opId);
        this.clock.merge(VectorClock.fromJSON(op.causalDeps));

        const key = op.data.key;
        const existing = this._entries.get(key);

        const incoming = {
            value: op.type === 'lwwmap:delete' ? undefined : op.data.value,
            timestamp: op.data.timestamp,
            writerNodeId: op.nodeId,
            deleted: op.type === 'lwwmap:delete',
        };

        if (!existing || this._shouldReplace(existing, incoming)) {
            this._entries.set(key, incoming);
        }

        return true;
    }

    /**
     * Determine if incoming entry should replace existing.
     * @param {{timestamp: number, writerNodeId: string}} existing
     * @param {{timestamp: number, writerNodeId: string}} incoming
     * @returns {boolean}
     */
    _shouldReplace(existing, incoming) {
        if (incoming.timestamp > existing.timestamp) return true;
        if (incoming.timestamp === existing.timestamp) {
            return incoming.writerNodeId > existing.writerNodeId;
        }
        return false;
    }

    /**
     * State-based merge with remote map state.
     * @param {object} remoteState - { entries: Array<[key, entry]>, clock }
     */
    merge(remoteState) {
        for (const [key, entry] of remoteState.entries) {
            const existing = this._entries.get(key);
            if (!existing || this._shouldReplace(existing, entry)) {
                this._entries.set(key, { ...entry });
            }
        }
        if (remoteState.clock) {
            this.clock.merge(VectorClock.fromJSON(remoteState.clock));
        }
    }

    /**
     * Convert to a plain JS object (non-deleted entries only).
     * @returns {Record<string, *>}
     */
    toObject() {
        const result = {};
        for (const [key, entry] of this._entries) {
            if (!entry.deleted) result[key] = entry.value;
        }
        return result;
    }

    /**
     * Serialize to a plain object (includes tombstones).
     * @returns {object}
     */
    toJSON() {
        return {
            id: this.id,
            nodeId: this.nodeId,
            entries: [...this._entries.entries()],
            clock: this.clock.toJSON(),
        };
    }

    /**
     * Restore from a plain object.
     * @param {object} data
     * @returns {LWWMap}
     */
    static fromJSON(data) {
        const map = new LWWMap(data.id, data.nodeId);
        map._entries = new Map(data.entries);
        map.clock = VectorClock.fromJSON(data.clock);
        return map;
    }

    /**
     * Garbage-collect tombstoned (deleted) entries older than the given age.
     *
     * Unlike RGA, LWWMap tombstones are simpler: a deleted key's tombstone
     * only needs to persist long enough for all peers to have received it.
     * After that, the entry can be safely removed.
     *
     * @param {number} [maxAgeMs=60000] - Maximum age of tombstones in ms (default: 60s)
     * @returns {{ removed: number, remaining: number }}
     */
    gc(maxAgeMs = 60000) {
        const now = Date.now();
        let removed = 0;

        for (const [key, entry] of this._entries) {
            if (entry.deleted && (now - entry.timestamp) > maxAgeMs) {
                this._entries.delete(key);
                removed++;
            }
        }

        return { removed, remaining: this._entries.size };
    }

    /**
     * Get memory/health stats.
     * @returns {{ total: number, live: number, tombstoned: number, appliedOps: number }}
     */
    stats() {
        let live = 0;
        let tombstoned = 0;
        for (const entry of this._entries.values()) {
            if (entry.deleted) tombstoned++;
            else live++;
        }
        return { total: this._entries.size, live, tombstoned, appliedOps: this._appliedOps.size };
    }

    /**
     * Prune the applied-ops deduplication set.
     * @param {number} [maxSize=10000]
     * @returns {number} Number of op IDs pruned
     */
    pruneOpHistory(maxSize = 10000) {
        if (this._appliedOps.size <= maxSize) return 0;
        const arr = [...this._appliedOps];
        const pruneCount = arr.length - maxSize;
        for (let i = 0; i < pruneCount; i++) {
            this._appliedOps.delete(arr[i]);
        }
        return pruneCount;
    }
}

