import { describe, it, expect } from 'vitest';
import { LWWMap } from '../../src/core/LWWMap.js';

describe('LWWMap', () => {
    it('should start empty', () => {
        const map = new LWWMap('m1', 'nodeA');
        expect(map.keys()).toEqual([]);
        expect(map.get('x')).toBeUndefined();
    });

    it('should set and get', () => {
        const map = new LWWMap('m1', 'nodeA');
        map.set('color', 'red');
        expect(map.get('color')).toBe('red');
        expect(map.has('color')).toBe(true);
        expect(map.keys()).toContain('color');
    });

    it('should delete with tombstone', () => {
        const map = new LWWMap('m1', 'nodeA');
        map.set('temp', 'value');
        map.delete('temp');
        expect(map.get('temp')).toBeUndefined();
        expect(map.has('temp')).toBe(false);
    });

    it('should apply remote set', () => {
        const a = new LWWMap('m1', 'nodeA');
        const b = new LWWMap('m1', 'nodeB');

        const op = b.set('key', 'from B');
        a.apply(op);
        expect(a.get('key')).toBe('from B');
    });

    it('should apply remote delete', async () => {
        const a = new LWWMap('m1', 'nodeA');
        const b = new LWWMap('m1', 'nodeB');

        a.set('key', 'value');
        // Simulate: B also has this key and deletes it later
        await new Promise((r) => setTimeout(r, 5));
        const delOp = b.delete('key');
        a.apply(delOp);
        expect(a.has('key')).toBe(false);
    });

    it('should deduplicate operations', () => {
        const a = new LWWMap('m1', 'nodeA');
        const b = new LWWMap('m1', 'nodeB');

        const op = b.set('k', 'v');
        expect(a.apply(op)).toBe(true);
        expect(a.apply(op)).toBe(false);
    });

    it('should converge with concurrent writes (LWW)', async () => {
        const a = new LWWMap('m1', 'nodeA');
        const b = new LWWMap('m1', 'nodeB');

        const opA = a.set('theme', 'dark');
        await new Promise((r) => setTimeout(r, 5));
        const opB = b.set('theme', 'light');

        // Both apply each other's ops
        a.apply(opB);
        b.apply(opA);

        // Both should converge to 'light' (later timestamp)
        expect(a.get('theme')).toBe(b.get('theme'));
    });

    it('should convert to plain object', () => {
        const map = new LWWMap('m1', 'nodeA');
        map.set('a', 1);
        map.set('b', 2);
        map.set('c', 3);
        map.delete('b');

        const obj = map.toObject();
        expect(obj).toEqual({ a: 1, c: 3 });
    });

    it('should serialize and deserialize', () => {
        const map = new LWWMap('m1', 'nodeA');
        map.set('x', 'hello');
        map.set('y', 42);

        const json = map.toJSON();
        const restored = LWWMap.fromJSON(json);
        expect(restored.get('x')).toBe('hello');
        expect(restored.get('y')).toBe(42);
    });
});
