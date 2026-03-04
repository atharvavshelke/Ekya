/**
 * VectorClock — Causal ordering primitive for distributed CRDT operations.
 *
 * Each node maintains its own logical counter. Comparing two vector clocks
 * determines causal relationships: BEFORE, AFTER, CONCURRENT, or EQUAL.
 */
export class VectorClock {
    /**
     * @param {Record<string, number>} [clocks={}] - Initial clock values keyed by nodeId
     */
    constructor(clocks = {}) {
        /** @type {Record<string, number>} */
        this.clocks = { ...clocks };
    }

    /**
     * Increment this node's logical clock.
     * @param {string} nodeId
     * @returns {VectorClock} this (for chaining)
     */
    increment(nodeId) {
        this.clocks[nodeId] = (this.clocks[nodeId] || 0) + 1;
        return this;
    }

    /**
     * Get the clock value for a specific node.
     * @param {string} nodeId
     * @returns {number}
     */
    get(nodeId) {
        return this.clocks[nodeId] || 0;
    }

    /**
     * Merge another vector clock into this one (element-wise max).
     * @param {VectorClock} other
     * @returns {VectorClock} this (for chaining)
     */
    merge(other) {
        for (const [nodeId, value] of Object.entries(other.clocks)) {
            this.clocks[nodeId] = Math.max(this.clocks[nodeId] || 0, value);
        }
        return this;
    }

    /**
     * Compare this clock with another.
     * @param {VectorClock} other
     * @returns {'BEFORE'|'AFTER'|'CONCURRENT'|'EQUAL'}
     */
    compare(other) {
        const allNodes = new Set([
            ...Object.keys(this.clocks),
            ...Object.keys(other.clocks),
        ]);

        let isBeforeOrEqual = true; // all this[i] <= other[i]
        let isAfterOrEqual = true; // all this[i] >= other[i]

        for (const nodeId of allNodes) {
            const a = this.clocks[nodeId] || 0;
            const b = other.clocks[nodeId] || 0;

            if (a > b) isBeforeOrEqual = false;
            if (a < b) isAfterOrEqual = false;
        }

        if (isBeforeOrEqual && isAfterOrEqual) return 'EQUAL';
        if (isBeforeOrEqual) return 'BEFORE';
        if (isAfterOrEqual) return 'AFTER';
        return 'CONCURRENT';
    }

    /**
     * Create a deep copy of this vector clock.
     * @returns {VectorClock}
     */
    clone() {
        return new VectorClock({ ...this.clocks });
    }

    /**
     * Serialize to a plain object.
     * @returns {Record<string, number>}
     */
    toJSON() {
        return { ...this.clocks };
    }

    /**
     * Create from a plain object.
     * @param {Record<string, number>} data
     * @returns {VectorClock}
     */
    static fromJSON(data) {
        return new VectorClock(data);
    }
}
