import { describe, it, expect } from 'vitest';
import { VectorClock } from '../../src/core/VectorClock.js';

describe('VectorClock', () => {
    it('should start with zero values', () => {
        const vc = new VectorClock();
        expect(vc.get('node1')).toBe(0);
    });

    it('should increment a node clock', () => {
        const vc = new VectorClock();
        vc.increment('node1');
        expect(vc.get('node1')).toBe(1);
        vc.increment('node1');
        expect(vc.get('node1')).toBe(2);
    });

    it('should merge with element-wise max', () => {
        const a = new VectorClock({ node1: 3, node2: 1 });
        const b = new VectorClock({ node1: 1, node2: 5, node3: 2 });
        a.merge(b);
        expect(a.get('node1')).toBe(3);
        expect(a.get('node2')).toBe(5);
        expect(a.get('node3')).toBe(2);
    });

    it('should compare EQUAL clocks', () => {
        const a = new VectorClock({ node1: 1, node2: 2 });
        const b = new VectorClock({ node1: 1, node2: 2 });
        expect(a.compare(b)).toBe('EQUAL');
    });

    it('should compare BEFORE', () => {
        const a = new VectorClock({ node1: 1, node2: 1 });
        const b = new VectorClock({ node1: 2, node2: 2 });
        expect(a.compare(b)).toBe('BEFORE');
    });

    it('should compare AFTER', () => {
        const a = new VectorClock({ node1: 3, node2: 3 });
        const b = new VectorClock({ node1: 1, node2: 2 });
        expect(a.compare(b)).toBe('AFTER');
    });

    it('should compare CONCURRENT', () => {
        const a = new VectorClock({ node1: 3, node2: 1 });
        const b = new VectorClock({ node1: 1, node2: 3 });
        expect(a.compare(b)).toBe('CONCURRENT');
    });

    it('should clone correctly', () => {
        const a = new VectorClock({ node1: 5 });
        const b = a.clone();
        b.increment('node1');
        expect(a.get('node1')).toBe(5);
        expect(b.get('node1')).toBe(6);
    });

    it('should serialize and deserialize', () => {
        const a = new VectorClock({ node1: 3, node2: 7 });
        const json = a.toJSON();
        const b = VectorClock.fromJSON(json);
        expect(b.compare(a)).toBe('EQUAL');
    });
});
