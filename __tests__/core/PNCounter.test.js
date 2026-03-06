import { describe, it, expect } from 'vitest';
import { PNCounter } from '../../src/core/PNCounter.js';

describe('PNCounter', () => {
    it('should start at zero', () => {
        const c = new PNCounter('votes', 'nodeA');
        expect(c.value()).toBe(0);
    });

    it('should increment correctly', () => {
        const c = new PNCounter('votes', 'nodeA');
        c.increment(5);
        c.increment(3);
        expect(c.value()).toBe(8);
        expect(c.positiveValue()).toBe(8);
        expect(c.negativeValue()).toBe(0);
    });

    it('should decrement correctly', () => {
        const c = new PNCounter('votes', 'nodeA');
        c.increment(10);
        c.decrement(3);
        expect(c.value()).toBe(7);
        expect(c.positiveValue()).toBe(10);
        expect(c.negativeValue()).toBe(3);
    });

    it('should go negative', () => {
        const c = new PNCounter('temp', 'nodeA');
        c.decrement(5);
        expect(c.value()).toBe(-5);
    });

    it('should apply remote increment operations', () => {
        const c1 = new PNCounter('votes', 'nodeA');
        const c2 = new PNCounter('votes', 'nodeB');

        const op = c1.increment(5);
        c2.apply(op);

        expect(c2.value()).toBe(5);
    });

    it('should apply remote decrement operations', () => {
        const c1 = new PNCounter('votes', 'nodeA');
        const c2 = new PNCounter('votes', 'nodeB');

        c2.increment(10);
        const op = c1.decrement(3);
        c2.apply(op);

        expect(c2.value()).toBe(7);
    });

    it('should deduplicate operations', () => {
        const c1 = new PNCounter('votes', 'nodeA');
        const c2 = new PNCounter('votes', 'nodeB');

        const op = c1.increment(5);
        expect(c2.apply(op)).toBe(true);
        expect(c2.apply(op)).toBe(false); // duplicate
        expect(c2.value()).toBe(5); // not double-counted
    });

    it('should converge across multiple nodes', () => {
        const c1 = new PNCounter('votes', 'nodeA');
        const c2 = new PNCounter('votes', 'nodeB');
        const c3 = new PNCounter('votes', 'nodeC');

        const op1 = c1.increment(5);
        const op2 = c2.decrement(2);
        const op3 = c3.increment(10);

        // Apply all ops to all nodes
        [c1, c2, c3].forEach((c) => {
            c.apply(op1);
            c.apply(op2);
            c.apply(op3);
        });

        // All nodes converge to 5 - 2 + 10 = 13
        expect(c1.value()).toBe(13);
        expect(c2.value()).toBe(13);
        expect(c3.value()).toBe(13);
    });

    it('should merge state correctly', () => {
        const c1 = new PNCounter('votes', 'nodeA');
        const c2 = new PNCounter('votes', 'nodeB');

        c1.increment(5);
        c2.decrement(3);

        c1.merge(c2.toJSON());
        expect(c1.value()).toBe(2); // 5 - 3

        // Idempotent
        c1.merge(c2.toJSON());
        expect(c1.value()).toBe(2);
    });

    it('should serialize and restore correctly', () => {
        const c = new PNCounter('votes', 'nodeA');
        c.increment(10);
        c.decrement(3);

        const json = c.toJSON();
        const restored = PNCounter.fromJSON(json);

        expect(restored.value()).toBe(7);
        expect(restored.positiveValue()).toBe(10);
        expect(restored.negativeValue()).toBe(3);
        expect(restored.id).toBe('votes');
    });

    it('should reject non-positive amounts', () => {
        const c = new PNCounter('votes', 'nodeA');
        expect(() => c.increment(0)).toThrow();
        expect(() => c.increment(-1)).toThrow();
        expect(() => c.decrement(0)).toThrow();
        expect(() => c.decrement(-1)).toThrow();
    });

    it('should report stats', () => {
        const c = new PNCounter('votes', 'nodeA');
        c.increment(10);
        c.decrement(3);

        const stats = c.stats();
        expect(stats.nodes).toBe(1);
        expect(stats.value).toBe(7);
        expect(stats.increments).toBe(10);
        expect(stats.decrements).toBe(3);
        expect(stats.appliedOps).toBe(2);
    });

    it('should prune op history', () => {
        const c = new PNCounter('votes', 'nodeA');
        for (let i = 0; i < 20; i++) {
            c.increment(1);
        }
        expect(c.stats().appliedOps).toBe(20);

        // Simulate 15 ops being older than 1 hour
        let count = 0;
        const oneHourMs = 60 * 60 * 1000;
        for (const opId of c._appliedOps.keys()) {
            if (count < 15) {
                c._appliedOps.set(opId, Date.now() - (2 * oneHourMs));
            }
            count++;
        }

        const pruned = c.pruneOpHistory(oneHourMs);
        expect(pruned).toBe(15);
        expect(c.stats().appliedOps).toBe(5);
        expect(c.value()).toBe(20); // value unchanged
    });
});
