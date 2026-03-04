import { VectorClock } from './VectorClock.js';
import { Operation } from './Operation.js';

/**
 * GCounter — Grow-only Counter CRDT.
 *
 * Each node maintains its own monotonically increasing count.
 * The total value is the sum of all per-node counts.
 * Merge takes the element-wise maximum.
 *
 * Properties:
 *   - Commutative: merge(A, B) = merge(B, A)
 *   - Associative: merge(merge(A, B), C) = merge(A, merge(B, C))
 *   - Idempotent: merge(A, A) = A
 */
export class GCounter {
    /**
     * @param {string} id - Unique identifier for this CRDT instance
     * @param {string} nodeId - ID of the local node
     */
    constructor(id, nodeId) {
        this.id = id;
        this.nodeId = nodeId;
        /** @type {Record<string, number>} */
        this.counts = {};
        this.clock = new VectorClock();
        /** @type {Set<string>} */
        this._appliedOps = new Set();
    }

    /**
     * Increment this node's counter by the given amount.
     * @param {number} [amount=1]
     * @returns {Operation} The operation that was applied
     */
    increment(amount = 1) {
        if (amount <= 0) throw new Error('GCounter can only increment by positive amounts');

        this.counts[this.nodeId] = (this.counts[this.nodeId] || 0) + amount;
        this.clock.increment(this.nodeId);

        const op = new Operation({
            type: 'gcounter:increment',
            crdtId: this.id,
            nodeId: this.nodeId,
            clock: this.clock.get(this.nodeId),
            causalDeps: this.clock.toJSON(),
            data: { amount },
        });

        this._appliedOps.add(op.opId);
        return op;
    }

    /**
     * Apply a remote operation (with deduplication).
     * @param {Operation} op
     * @returns {boolean} true if the operation was applied (not a duplicate)
     */
    apply(op) {
        if (this._appliedOps.has(op.opId)) return false;

        if (op.type !== 'gcounter:increment') {
            throw new Error(`GCounter cannot apply operation of type: ${op.type}`);
        }

        this.counts[op.nodeId] = (this.counts[op.nodeId] || 0) + op.data.amount;
        this.clock.merge(VectorClock.fromJSON(op.causalDeps));
        this._appliedOps.add(op.opId);
        return true;
    }

    /**
     * Get the total counter value.
     * @returns {number}
     */
    value() {
        return Object.values(this.counts).reduce((sum, n) => sum + n, 0);
    }

    /**
     * State-based merge with another GCounter.
     * Takes element-wise max of all per-node counts.
     * @param {object} remoteState - Remote counter state { counts, clock }
     */
    merge(remoteState) {
        for (const [nodeId, value] of Object.entries(remoteState.counts)) {
            this.counts[nodeId] = Math.max(this.counts[nodeId] || 0, value);
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
            counts: { ...this.counts },
            clock: this.clock.toJSON(),
        };
    }

    /**
     * Restore from a plain object.
     * @param {object} data
     * @returns {GCounter}
     */
    static fromJSON(data) {
        const counter = new GCounter(data.id, data.nodeId);
        counter.counts = { ...data.counts };
        counter.clock = VectorClock.fromJSON(data.clock);
        return counter;
    }

    /**
     * Get memory/health stats.
     * @returns {{ nodes: number, totalValue: number, appliedOps: number }}
     */
    stats() {
        return {
            nodes: Object.keys(this.counts).length,
            totalValue: this.value(),
            appliedOps: this._appliedOps.size,
        };
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

