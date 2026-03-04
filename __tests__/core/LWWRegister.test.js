import { describe, it, expect } from 'vitest';
import { LWWRegister } from '../../src/core/LWWRegister.js';

describe('LWWRegister', () => {
    it('should start undefined', () => {
        const reg = new LWWRegister('r1', 'nodeA');
        expect(reg.get()).toBeUndefined();
    });

    it('should set and get', () => {
        const reg = new LWWRegister('r1', 'nodeA');
        reg.set('hello');
        expect(reg.get()).toBe('hello');
    });

    it('should produce operations', () => {
        const reg = new LWWRegister('r1', 'nodeA');
        const op = reg.set('world');
        expect(op.type).toBe('lww:set');
        expect(op.data.value).toBe('world');
    });

    it('should apply remote operations', () => {
        const a = new LWWRegister('r1', 'nodeA');
        const b = new LWWRegister('r1', 'nodeB');

        const op = b.set('from B');
        a.apply(op);
        expect(a.get()).toBe('from B');
    });

    it('should deduplicate operations', () => {
        const a = new LWWRegister('r1', 'nodeA');
        const b = new LWWRegister('r1', 'nodeB');

        const op = b.set('value');
        expect(a.apply(op)).toBe(true);
        expect(a.apply(op)).toBe(false);
    });

    it('should resolve by latest timestamp', async () => {
        const a = new LWWRegister('r1', 'nodeA');
        const b = new LWWRegister('r1', 'nodeB');

        a.set('first');
        // Small delay to ensure different timestamps
        await new Promise((resolve) => setTimeout(resolve, 5));
        const opB = b.set('second');

        a.apply(opB);
        expect(a.get()).toBe('second');
    });

    it('should serialize and deserialize', () => {
        const reg = new LWWRegister('r1', 'nodeA');
        reg.set('persistent');

        const json = reg.toJSON();
        const restored = LWWRegister.fromJSON(json);
        expect(restored.get()).toBe('persistent');
        expect(restored.id).toBe('r1');
    });
});
