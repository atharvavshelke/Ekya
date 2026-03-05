import { VectorClock } from './VectorClock.js';
import { Operation } from './Operation.js';

/**
 * LWWRegister — Last-Writer-Wins Register CRDT.
 *
 * Holds a single value. On concurrent writes, the one with the higher
 * timestamp wins. Ties are broken by lexicographic nodeId comparison
 * (deterministic across all peers).
 *
 * Uses a Hybrid Logical Clock approach: monotonic timestamp + nodeId tie-break.
 */
export class LWWRegister {
    /**
     * @param {string} id - Unique identifier for this CRDT instance
     * @param {string} nodeId - ID of the local node
     */
    constructor(id, nodeId) {
        this.id = id;
        this.nodeId = nodeId;
        this._value = undefined;
        this._timestamp = 0;
        this._writerNodeId = '';
        this.clock = new VectorClock();
        /** @type {Set<string>} */
        this._appliedOps = new Set();
    }

    /**
     * Set the register value.
     * @param {*} value
     * @returns {Operation}
     */
    set(value) {
        this.clock.increment(this.nodeId);
        this._timestamp = Date.now();
        this._value = value;
        this._writerNodeId = this.nodeId;

        const op = new Operation({
            type: 'lww:set',
            crdtId: this.id,
            nodeId: this.nodeId,
            clock: this.clock.get(this.nodeId),
            causalDeps: this.clock.toJSON(),
            data: { value, timestamp: this._timestamp },
        });

        this._appliedOps.add(op.opId);
        return op;
    }

    /**
     * Get the current register value.
     * @returns {*}
     */
    get() {
        return this._value;
    }

    /**
     * Apply a remote operation (with deduplication).
     * @param {Operation} op
     * @returns {boolean} true if the operation was applied
     */
    apply(op) {
        if (this._appliedOps.has(op.opId)) return false;

        // Phase 4: Strict Sequence Replay Protection
        if (op.clock <= this.clock.get(op.nodeId)) return false;

        if (op.type !== 'lww:set') {
            throw new Error(`LWWRegister cannot apply operation of type: ${op.type}`);
        }

        this._appliedOps.add(op.opId);
        this.clock.merge(VectorClock.fromJSON(op.causalDeps));

        // LWW resolution: highest timestamp wins; tie-break by nodeId (lexicographic)
        if (this._shouldReplace(op.data.timestamp, op.nodeId)) {
            this._value = op.data.value;
            this._timestamp = op.data.timestamp;
            this._writerNodeId = op.nodeId;
        }

        return true;
    }

    /**
     * Determine if a remote write should replace the local value.
     * @param {number} remoteTimestamp
     * @param {string} remoteNodeId
     * @returns {boolean}
     */
    _shouldReplace(remoteTimestamp, remoteNodeId) {
        if (remoteTimestamp > this._timestamp) return true;
        if (remoteTimestamp === this._timestamp) {
            return remoteNodeId > this._writerNodeId;
        }
        return false;
    }

    /**
     * State-based merge with a remote register.
     * @param {object} remoteState - { value, timestamp, writerNodeId, clock }
     */
    merge(remoteState) {
        if (this._shouldReplace(remoteState.timestamp, remoteState.writerNodeId)) {
            this._value = remoteState.value;
            this._timestamp = remoteState.timestamp;
            this._writerNodeId = remoteState.writerNodeId;
        }
        if (remoteState.clock) {
            this.clock.merge(VectorClock.fromJSON(remoteState.clock));
        }
    }

    /**
     * Serialize to a plain object.
     * @returns {object}
     */
    toJSON() {
        return {
            id: this.id,
            nodeId: this.nodeId,
            value: this._value,
            timestamp: this._timestamp,
            writerNodeId: this._writerNodeId,
            clock: this.clock.toJSON(),
            appliedOps: [...this._appliedOps],
        };
    }

    /**
     * Restore from a plain object.
     * @param {object} data
     * @returns {LWWRegister}
     */
    static fromJSON(data) {
        const reg = new LWWRegister(data.id, data.nodeId);
        reg._value = data.value;
        reg._timestamp = data.timestamp;
        reg._writerNodeId = data.writerNodeId;
        reg.clock = VectorClock.fromJSON(data.clock);
        if (data.appliedOps) {
            reg._appliedOps = new Set(data.appliedOps);
        }
        return reg;
    }
}
