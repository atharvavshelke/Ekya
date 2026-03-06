import { VectorClock } from './VectorClock.js';
import { Operation } from './Operation.js';

/**
 * PNCounter — Positive-Negative Counter CRDT.
 *
 * A counter that supports both increment AND decrement operations.
 * Internally composed of two GCounters:
 *   - P (positive): tracks increments per node
 *   - N (negative): tracks decrements per node
 *
 * Value = sum(P) - sum(N)
 *
 * Properties:
 *   - Commutative: merge(A, B) = merge(B, A)
 *   - Associative: merge(merge(A, B), C) = merge(A, merge(B, C))
 *   - Idempotent: merge(A, A) = A
 *
 * Use cases: vote counts, inventory tracking, score counters.
 */
export class PNCounter {
    /**
     * @param {string} id - Unique identifier for this CRDT instance
     * @param {string} nodeId - ID of the local node
     */
    constructor(id, nodeId) {
        this.id = id;
        this.nodeId = nodeId;
        /** @type {Record<string, number>} increments per node */
        this.p = {};
        /** @type {Record<string, number>} decrements per node */
        this.n = {};
        this.clock = new VectorClock();
        /** @type {Map<string, number>} opId -> timestamp */
        this._appliedOps = new Map();
    }

    /**
     * Increment this node's counter.
     * @param {number} [amount=1]
     * @returns {Operation}
     */
    increment(amount = 1) {
        if (amount <= 0) throw new Error('Increment amount must be positive');

        this.p[this.nodeId] = (this.p[this.nodeId] || 0) + amount;
        this.clock.increment(this.nodeId);

        const op = new Operation({
            type: 'pncounter:increment',
            crdtId: this.id,
            nodeId: this.nodeId,
            clock: this.clock.get(this.nodeId),
            causalDeps: this.clock.toJSON(),
            data: { amount },
        });

        this._appliedOps.set(op.opId, Date.now());
        return op;
    }

    /**
     * Decrement this node's counter.
     * @param {number} [amount=1]
     * @returns {Operation}
     */
    decrement(amount = 1) {
        if (amount <= 0) throw new Error('Decrement amount must be positive');

        this.n[this.nodeId] = (this.n[this.nodeId] || 0) + amount;
        this.clock.increment(this.nodeId);

        const op = new Operation({
            type: 'pncounter:decrement',
            crdtId: this.id,
            nodeId: this.nodeId,
            clock: this.clock.get(this.nodeId),
            causalDeps: this.clock.toJSON(),
            data: { amount },
        });

        this._appliedOps.set(op.opId, Date.now());
        return op;
    }

    /**
     * Apply a remote operation (with deduplication).
     * @param {Operation} op
     * @returns {boolean}
     */
    apply(op) {
        if (this._appliedOps.has(op.opId)) return false;

        // Phase 4: Strict Sequence Replay Protection
        if (op.clock <= this.clock.get(op.nodeId)) return false;

        if (op.type === 'pncounter:increment') {
            this.p[op.nodeId] = (this.p[op.nodeId] || 0) + op.data.amount;
        } else if (op.type === 'pncounter:decrement') {
            this.n[op.nodeId] = (this.n[op.nodeId] || 0) + op.data.amount;
        } else {
            throw new Error(`PNCounter cannot apply operation of type: ${op.type}`);
        }

        this.clock.merge(VectorClock.fromJSON(op.causalDeps));
        this._appliedOps.set(op.opId, Date.now());
        return true;
    }

    /**
     * Get the counter value (increments - decrements).
     * @returns {number}
     */
    value() {
        const pSum = Object.values(this.p).reduce((s, n) => s + n, 0);
        const nSum = Object.values(this.n).reduce((s, n) => s + n, 0);
        return pSum - nSum;
    }

    /**
     * Get the total increments.
     * @returns {number}
     */
    positiveValue() {
        return Object.values(this.p).reduce((s, n) => s + n, 0);
    }

    /**
     * Get the total decrements.
     * @returns {number}
     */
    negativeValue() {
        return Object.values(this.n).reduce((s, n) => s + n, 0);
    }

    /**
     * State-based merge with another PNCounter.
     * Takes element-wise max of both P and N vectors.
     * @param {object} remoteState - { p, n, clock }
     */
    merge(remoteState) {
        for (const [nodeId, value] of Object.entries(remoteState.p || {})) {
            this.p[nodeId] = Math.max(this.p[nodeId] || 0, value);
        }
        for (const [nodeId, value] of Object.entries(remoteState.n || {})) {
            this.n[nodeId] = Math.max(this.n[nodeId] || 0, value);
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
            p: { ...this.p },
            n: { ...this.n },
            clock: this.clock.toJSON(),
            appliedOps: [...this._appliedOps.entries()],
        };
    }

    /**
     * Restore from a plain object.
     * @param {object} data
     * @returns {PNCounter}
     */
    static fromJSON(data) {
        const counter = new PNCounter(data.id, data.nodeId);
        counter.p = { ...data.p };
        counter.n = { ...data.n };
        counter.clock = VectorClock.fromJSON(data.clock);
        if (data.appliedOps) {
            counter._appliedOps = new Map(data.appliedOps);
        }
        return counter;
    }

    /**
     * Get memory/health stats.
     * @returns {{ nodes: number, value: number, increments: number, decrements: number, appliedOps: number }}
     */
    stats() {
        const nodes = new Set([...Object.keys(this.p), ...Object.keys(this.n)]);
        return {
            nodes: nodes.size,
            value: this.value(),
            increments: this.positiveValue(),
            decrements: this.negativeValue(),
            appliedOps: this._appliedOps.size,
        };
    }

    /**
     * Prune the applied-ops deduplication cache.
     * Prevents snapshot bloat by removing opIds older than `maxAgeMs`.
     * Safety is maintained via the Lamport clock (sequence filtering).
     *
     * @param {number} [maxAgeMs=604800000] - Default 7 days
     * @returns {number}
     */
    pruneOpHistory(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
        if (this._appliedOps.size === 0) return 0;

        const now = Date.now();
        let pruneCount = 0;

        for (const [opId, timestamp] of this._appliedOps.entries()) {
            if (now - timestamp > maxAgeMs) {
                this._appliedOps.delete(opId);
                pruneCount++;
            }
        }

        return pruneCount;
    }
}
