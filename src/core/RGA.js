import { VectorClock } from './VectorClock.js';
import { Operation } from './Operation.js';

/**
 * RGA — Replicated Growable Array.
 *
 * The core data structure for collaborative text editing.
 * Each element has a unique ID: { nodeId, seq } which provides a total order.
 *
 * Concurrent inserts at the same position use deterministic tie-breaking:
 *   1. Higher timestamp wins (inserts later in wall-clock time go first — right bias)
 *   2. If timestamps equal, higher nodeId (lexicographic) wins
 *
 * This guarantees all peers converge to the exact same sequence regardless
 * of the order operations are received.
 *
 * Deletion marks elements as tombstones — they stay in the internal list
 * for ordering purposes but are excluded from visible output.
 */
export class RGA {
    /**
     * @param {string} id - Unique identifier for this CRDT instance
     * @param {string} nodeId - ID of the local node
     */
    constructor(id, nodeId) {
        this.id = id;
        this.nodeId = nodeId;
        this._seq = 0;
        /**
         * Internal list of elements: { elemId: {nodeId, seq}, value, deleted, timestamp }
         * @type {Array<{elemId: {nodeId: string, seq: number}, value: string, deleted: boolean, timestamp: number, afterId: {nodeId: string, seq: number}|null}>}
         */
        this._elements = [];
        this.clock = new VectorClock();
        /** @type {Set<string>} */
        this._appliedOps = new Set();
    }

    /**
     * Generate the next unique element ID for this node.
     * @returns {{nodeId: string, seq: number}}
     */
    _nextElemId() {
        this._seq++;
        return { nodeId: this.nodeId, seq: this._seq };
    }

    /**
     * Compare two element IDs for total ordering.
     * Used to resolve concurrent inserts at the same position.
     *
     * @param {{nodeId: string, seq: number, timestamp: number}} a
     * @param {{nodeId: string, seq: number, timestamp: number}} b
     * @returns {number} negative if a < b, positive if a > b, 0 if equal
     */
    static compareElemIds(a, b) {
        // Higher timestamp = inserted later = goes to the right (natural reading order)
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
        // Tie-break: lexicographic nodeId comparison
        if (a.nodeId !== b.nodeId) return a.nodeId < b.nodeId ? -1 : 1;
        // Same node: higher seq is later
        return a.seq - b.seq;
    }

    /**
     * Check if two element IDs are equal.
     * @param {{nodeId: string, seq: number}} a
     * @param {{nodeId: string, seq: number}} b
     * @returns {boolean}
     */
    static elemIdEquals(a, b) {
        if (a === null && b === null) return true;
        if (a === null || b === null) return false;
        return a.nodeId === b.nodeId && a.seq === b.seq;
    }

    /**
     * Find the internal index of an element by its elemId.
     * @param {{nodeId: string, seq: number}} elemId
     * @returns {number} index or -1
     */
    _findIndex(elemId) {
        if (!elemId) return -1;
        return this._elements.findIndex((e) => RGA.elemIdEquals(e.elemId, elemId));
    }

    /**
     * Insert a character at the given visible index.
     * @param {number} visibleIndex - Position in visible text (0-based)
     * @param {string} value - Character or string to insert
     * @returns {Operation}
     */
    insert(visibleIndex, value) {
        this.clock.increment(this.nodeId);
        const timestamp = Date.now();
        const elemId = this._nextElemId();

        // Find the element after which to insert (by visible index)
        const afterId = this._visibleIndexToAfterId(visibleIndex);

        // Find internal position to insert
        const internalPos = this._findInsertPosition(afterId, elemId, timestamp);

        const element = { elemId, value, deleted: false, timestamp, afterId };
        this._elements.splice(internalPos, 0, element);

        const op = new Operation({
            type: 'rga:insert',
            crdtId: this.id,
            nodeId: this.nodeId,
            clock: this.clock.get(this.nodeId),
            causalDeps: this.clock.toJSON(),
            data: {
                elemId,
                value,
                afterId,
                timestamp,
            },
        });

        this._appliedOps.add(op.opId);
        return op;
    }

    /**
     * Delete the character at the given visible index.
     * @param {number} visibleIndex - Position in visible text (0-based)
     * @returns {Operation}
     */
    delete(visibleIndex) {
        this.clock.increment(this.nodeId);

        // Find the element at the visible index
        let visibleCount = 0;
        let targetElem = null;
        for (const elem of this._elements) {
            if (!elem.deleted) {
                if (visibleCount === visibleIndex) {
                    targetElem = elem;
                    break;
                }
                visibleCount++;
            }
        }

        if (!targetElem) {
            throw new Error(`Delete out of bounds: visible index ${visibleIndex}`);
        }

        targetElem.deleted = true;

        const op = new Operation({
            type: 'rga:delete',
            crdtId: this.id,
            nodeId: this.nodeId,
            clock: this.clock.get(this.nodeId),
            causalDeps: this.clock.toJSON(),
            data: {
                elemId: targetElem.elemId,
            },
        });

        this._appliedOps.add(op.opId);
        return op;
    }

    /**
     * Convert a visible index to the afterId (the element after which to insert).
     * visibleIndex 0 → insert at beginning (afterId = null)
     * visibleIndex N → insert after the N-th visible element
     * @param {number} visibleIndex
     * @returns {{nodeId: string, seq: number}|null}
     */
    _visibleIndexToAfterId(visibleIndex) {
        if (visibleIndex === 0) return null;

        let count = 0;
        for (const elem of this._elements) {
            if (!elem.deleted) {
                count++;
                if (count === visibleIndex) {
                    return elem.elemId;
                }
            }
        }

        // Insert at end: return last visible element
        for (let i = this._elements.length - 1; i >= 0; i--) {
            if (!this._elements[i].deleted) {
                return this._elements[i].elemId;
            }
        }

        return null;
    }

    /**
     * Find the correct internal position to insert an element after afterId,
     * respecting the deterministic ordering for concurrent inserts.
     * @param {{nodeId: string, seq: number}|null} afterId
     * @param {{nodeId: string, seq: number}} newElemId
     * @param {number} timestamp
     * @returns {number}
     */
    _findInsertPosition(afterId, newElemId, timestamp) {
        let startPos;

        if (afterId === null) {
            startPos = 0;
        } else {
            const afterIdx = this._findIndex(afterId);
            if (afterIdx === -1) {
                // If afterId not found, insert at end
                return this._elements.length;
            }
            startPos = afterIdx + 1;
        }

        // Walk forward through elements that were also inserted after the same afterId.
        // Siblings (same afterId) are ordered by DESCENDING priority:
        //   higher timestamp first, then higher nodeId first.
        // We skip past siblings with HIGHER priority and insert before
        // the first sibling with LOWER or EQUAL priority.
        const newItem = { ...newElemId, timestamp };
        let pos = startPos;
        while (pos < this._elements.length) {
            const existing = this._elements[pos];
            // Stop if this element was inserted after a different parent
            if (!RGA.elemIdEquals(existing.afterId, afterId)) break;

            // Compare existing vs new: positive means existing has higher priority
            const cmp = RGA.compareElemIds(
                { ...existing.elemId, timestamp: existing.timestamp },
                newItem,
            );
            // If existing has LOWER priority (cmp < 0), insert here (new goes before it)
            // If equal (cmp === 0), insert here too (shouldn't happen with unique IDs)
            if (cmp <= 0) break;
            // existing has HIGHER priority, skip past it
            pos++;
        }

        return pos;
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

        this._appliedOps.add(op.opId);
        this.clock.merge(VectorClock.fromJSON(op.causalDeps));

        if (op.type === 'rga:insert') {
            return this._applyInsert(op);
        } else if (op.type === 'rga:delete') {
            return this._applyDelete(op);
        }

        throw new Error(`RGA cannot apply operation of type: ${op.type}`);
    }

    /**
     * Apply a remote insert operation.
     * @param {Operation} op
     * @returns {boolean}
     */
    _applyInsert(op) {
        const { elemId, value, afterId, timestamp } = op.data;

        // Check if already exists (duplicate element)
        if (this._findIndex(elemId) !== -1) return false;

        // Update local sequence counter to avoid collisions
        if (elemId.nodeId === this.nodeId) {
            this._seq = Math.max(this._seq, elemId.seq);
        }

        const pos = this._findInsertPosition(afterId, elemId, timestamp);
        this._elements.splice(pos, 0, {
            elemId,
            value,
            deleted: false,
            timestamp,
            afterId,
        });

        return true;
    }

    /**
     * Apply a remote delete operation.
     * @param {Operation} op
     * @returns {boolean}
     */
    _applyDelete(op) {
        const { elemId } = op.data;
        const idx = this._findIndex(elemId);
        if (idx === -1) return false; // Element not found (possibly not received yet)

        this._elements[idx].deleted = true;
        return true;
    }

    /**
     * Get the visible text as a string.
     * @returns {string}
     */
    toString() {
        return this._elements
            .filter((e) => !e.deleted)
            .map((e) => e.value)
            .join('');
    }

    /**
     * Get the visible elements as an array.
     * @returns {string[]}
     */
    toArray() {
        return this._elements.filter((e) => !e.deleted).map((e) => e.value);
    }

    /**
     * Get the number of visible characters.
     * @returns {number}
     */
    get length() {
        return this._elements.filter((e) => !e.deleted).length;
    }

    /**
     * Serialize to a plain object.
     * @returns {object}
     */
    toJSON() {
        return {
            id: this.id,
            nodeId: this.nodeId,
            seq: this._seq,
            elements: this._elements.map((e) => ({ ...e })),
            clock: this.clock.toJSON(),
            appliedOps: [...this._appliedOps],
        };
    }

    /**
     * Restore from a plain object.
     * @param {object} data
     * @returns {RGA}
     */
    static fromJSON(data) {
        const rga = new RGA(data.id, data.nodeId);
        rga._seq = data.seq;
        rga._elements = data.elements.map((e) => ({ ...e }));
        rga.clock = VectorClock.fromJSON(data.clock);
        if (data.appliedOps) {
            rga._appliedOps = new Set(data.appliedOps);
        }
        return rga;
    }

    // ─── Garbage Collection ─────────────────────────────────────

    /**
     * Garbage-collect tombstoned elements that are safe to remove.
     *
     * A tombstoned element can be GC'd if:
     *   - It is deleted (tombstoned)
     *   - No future insert can reference it as `afterId`
     *     (all peers have seen the delete operation)
     *   - No non-deleted element uses it as `afterId`
     *
     * For safety in v1, we use a conservative strategy:
     * only remove tombstones that have no live children
     * (no non-deleted element has afterId pointing to the tombstone).
     * 
     * If the total number of tombstones exceeds maxTombstones, the oldest
     * tombstones are forcefully pruned even if it risks a minor merge conflict,
     * to prevent memory exhaustion attacks.
     *
     * @param {number} [maxTombstones=100000] - Hard upper bound on tombstones
     * @returns {{ removed: number, remaining: number }}
     */
    gc(maxTombstones = 100000) {
        // Build a set of afterIds that are still referenced by live elements
        const referencedAfterIds = new Set();
        let tombstoneCount = 0;

        for (const elem of this._elements) {
            if (elem.deleted) tombstoneCount++;
            if (!elem.deleted && elem.afterId) {
                const key = `${elem.afterId.nodeId}:${elem.afterId.seq}`;
                referencedAfterIds.add(key);
            }
        }

        // Also check: other tombstones might reference this tombstone.
        const allReferenced = new Set();
        for (const elem of this._elements) {
            if (elem.afterId) {
                const key = `${elem.afterId.nodeId}:${elem.afterId.seq}`;
                allReferenced.add(key);
            }
        }

        const before = this._elements.length;
        const forcePruneCount = Math.max(0, tombstoneCount - maxTombstones);
        let prunedForced = 0;

        this._elements = this._elements.filter((elem) => {
            if (!elem.deleted) return true; // Keep live elements

            // Phase 5: Hard memory bounds. Drop oldest tombstones if over limit.
            if (prunedForced < forcePruneCount) {
                prunedForced++;
                return false;
            }

            const key = `${elem.elemId.nodeId}:${elem.elemId.seq}`;
            // Keep if any element references this as its afterId
            if (allReferenced.has(key)) return true;

            // Safe to remove — no one references this tombstone
            return false;
        });

        const removed = before - this._elements.length;
        return { removed, remaining: this._elements.length };
    }

    /**
     * Get memory/health stats.
     * @returns {{ total: number, live: number, tombstoned: number, appliedOps: number }}
     */
    stats() {
        const live = this._elements.filter((e) => !e.deleted).length;
        return {
            total: this._elements.length,
            live,
            tombstoned: this._elements.length - live,
            appliedOps: this._appliedOps.size,
        };
    }

    /**
     * Prune the applied-ops deduplication set.
     * After a snapshot has been distributed and all peers are synced,
     * the op history can be safely reduced.
     *
     * @param {number} [maxSize=10000] - Maximum number of op IDs to retain
     * @returns {number} Number of op IDs pruned
     */
    pruneOpHistory(maxSize = 10000) {
        if (this._appliedOps.size <= maxSize) return 0;

        const arr = [...this._appliedOps];
        const pruneCount = arr.length - maxSize;
        // Remove oldest entries (Set preserves insertion order)
        for (let i = 0; i < pruneCount; i++) {
            this._appliedOps.delete(arr[i]);
        }
        return pruneCount;
    }
}

