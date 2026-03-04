import { describe, it, expect } from 'vitest';
import { GCounter } from '../../src/core/GCounter.js';

describe('GCounter', () => {
    it('should start at zero', () => {
        const c = new GCounter('c1', 'nodeA');
        expect(c.value()).toBe(0);
    });

    it('should increment', () => {
        const c = new GCounter('c1', 'nodeA');
        c.increment();
        expect(c.value()).toBe(1);
        c.increment(5);
        expect(c.value()).toBe(6);
    });

    it('should reject non-positive increments', () => {
        const c = new GCounter('c1', 'nodeA');
        expect(() => c.increment(0)).toThrow();
        expect(() => c.increment(-1)).toThrow();
    });

    it('should produce operations', () => {
        const c = new GCounter('c1', 'nodeA');
        const op = c.increment(3);
        expect(op.type).toBe('gcounter:increment');
        expect(op.data.amount).toBe(3);
        expect(op.nodeId).toBe('nodeA');
    });

    it('should apply remote operations', () => {
        const a = new GCounter('c1', 'nodeA');
        const b = new GCounter('c1', 'nodeB');

        const op = b.increment(10);
        a.apply(op);

        expect(a.value()).toBe(10);
    });

    it('should deduplicate operations', () => {
        const a = new GCounter('c1', 'nodeA');
        const b = new GCounter('c1', 'nodeB');

        const op = b.increment(5);
        expect(a.apply(op)).toBe(true);
        expect(a.apply(op)).toBe(false); // duplicate
        expect(a.value()).toBe(5); // not 10
    });

    it('should converge with multi-node increments', () => {
        const a = new GCounter('c1', 'nodeA');
        const b = new GCounter('c1', 'nodeB');
        const c = new GCounter('c1', 'nodeC');

        const opA = a.increment(3);
        const opB = b.increment(7);
        const opC = c.increment(2);

        // Apply all ops to all counters
        a.apply(opB);
        a.apply(opC);
        b.apply(opA);
        b.apply(opC);
        c.apply(opA);
        c.apply(opB);

        expect(a.value()).toBe(12);
        expect(b.value()).toBe(12);
        expect(c.value()).toBe(12);
    });

    it('should merge state-based', () => {
        const a = new GCounter('c1', 'nodeA');
        const b = new GCounter('c1', 'nodeB');

        a.increment(5);
        b.increment(3);

        a.merge(b.toJSON());
        expect(a.value()).toBe(8);
    });

    it('should be commutative (merge order doesn\'t matter)', () => {
        const a = new GCounter('c1', 'nodeA');
        const b = new GCounter('c1', 'nodeB');

        a.increment(5);
        b.increment(3);

        const aClone = GCounter.fromJSON(a.toJSON());
        const bClone = GCounter.fromJSON(b.toJSON());

        aClone.merge(b.toJSON());
        bClone.merge(a.toJSON());

        expect(aClone.value()).toBe(bClone.value());
    });

    it('should be idempotent (merge(A,A) = A)', () => {
        const a = new GCounter('c1', 'nodeA');
        a.increment(5);

        const before = a.value();
        a.merge(a.toJSON());
        expect(a.value()).toBe(before);
    });

    it('should serialize and deserialize', () => {
        const a = new GCounter('c1', 'nodeA');
        a.increment(42);

        const json = a.toJSON();
        const restored = GCounter.fromJSON(json);
        expect(restored.value()).toBe(42);
        expect(restored.id).toBe('c1');
    });
});
