import { createHash } from 'crypto';

/**
 * Operation — The atomic unit of CRDT mutation.
 *
 * Every CRDT change produces an Operation. Operations are what get encrypted
 * and transmitted. Each operation has a unique `opId` for deduplication and
 * `causalDeps` (vector clock snapshot) for ordering.
 *
 * opId = SHA-256(nodeId + clock + type + crdtId + JSON(data))
 */
export class Operation {
    /**
     * @param {object} params
     * @param {string} params.type - Operation type (e.g., 'gcounter:increment', 'lww:set')
     * @param {string} params.crdtId - ID of the CRDT this operation targets
     * @param {string} params.nodeId - ID of the originating node
     * @param {number} params.clock - Logical clock value at time of creation
     * @param {Record<string, number>} params.causalDeps - Vector clock snapshot (causal dependencies)
     * @param {*} params.data - Operation-specific payload
     * @param {string} [params.opId] - Precomputed operation ID (generated if not provided)
     */
    constructor({ type, crdtId, nodeId, clock, causalDeps, data, opId }) {
        this.type = type;
        this.crdtId = crdtId;
        this.nodeId = nodeId;
        this.clock = clock;
        this.causalDeps = causalDeps;
        this.data = data;
        this.opId = opId || Operation.computeId({ type, crdtId, nodeId, clock, data });
    }

    /**
     * Compute a deterministic operation ID.
     * @param {object} params
     * @returns {string} hex-encoded SHA-256 hash
     */
    static computeId({ type, crdtId, nodeId, clock, data }) {
        const payload = `${nodeId}:${clock}:${type}:${crdtId}:${JSON.stringify(data)}`;
        return createHash('sha256').update(payload).digest('hex');
    }

    /**
     * Serialize to a plain object for transmission.
     * @returns {object}
     */
    toJSON() {
        return {
            opId: this.opId,
            type: this.type,
            crdtId: this.crdtId,
            nodeId: this.nodeId,
            clock: this.clock,
            causalDeps: this.causalDeps,
            data: this.data,
        };
    }

    /**
     * Reconstruct from a plain object.
     * @param {object} json
     * @returns {Operation}
     */
    static fromJSON(json) {
        return new Operation(json);
    }
}
