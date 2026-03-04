import { describe, it, expect } from 'vitest';
import { RGA } from '../../src/core/RGA.js';

describe('RGA', () => {
    it('should start empty', () => {
        const rga = new RGA('text1', 'nodeA');
        expect(rga.toString()).toBe('');
        expect(rga.length).toBe(0);
    });

    it('should insert single characters', () => {
        const rga = new RGA('text1', 'nodeA');
        rga.insert(0, 'H');
        rga.insert(1, 'i');
        expect(rga.toString()).toBe('Hi');
    });

    it('should insert at beginning', () => {
        const rga = new RGA('text1', 'nodeA');
        rga.insert(0, 'b');
        rga.insert(0, 'a');
        expect(rga.toString()).toBe('ab');
    });

    it('should delete characters', () => {
        const rga = new RGA('text1', 'nodeA');
        rga.insert(0, 'A');
        rga.insert(1, 'B');
        rga.insert(2, 'C');
        rga.delete(1); // delete 'B'
        expect(rga.toString()).toBe('AC');
    });

    it('should produce operations for insert', () => {
        const rga = new RGA('text1', 'nodeA');
        const op = rga.insert(0, 'X');
        expect(op.type).toBe('rga:insert');
        expect(op.data.value).toBe('X');
        expect(op.data.elemId).toBeDefined();
    });

    it('should produce operations for delete', () => {
        const rga = new RGA('text1', 'nodeA');
        rga.insert(0, 'X');
        const op = rga.delete(0);
        expect(op.type).toBe('rga:delete');
        expect(op.data.elemId).toBeDefined();
    });

    it('should apply remote insert', () => {
        const a = new RGA('text1', 'nodeA');
        const b = new RGA('text1', 'nodeB');

        const op = b.insert(0, 'B');
        a.apply(op);
        expect(a.toString()).toBe('B');
    });

    it('should apply remote delete', () => {
        const a = new RGA('text1', 'nodeA');
        const b = new RGA('text1', 'nodeB');

        const insertOp = a.insert(0, 'X');
        b.apply(insertOp);

        const deleteOp = b.delete(0);
        a.apply(deleteOp);

        expect(a.toString()).toBe('');
        expect(b.toString()).toBe('');
    });

    it('should deduplicate operations', () => {
        const a = new RGA('text1', 'nodeA');
        const b = new RGA('text1', 'nodeB');

        const op = b.insert(0, 'Z');
        expect(a.apply(op)).toBe(true);
        expect(a.apply(op)).toBe(false);
        expect(a.toString()).toBe('Z');
    });

    it('should converge with concurrent inserts at same position', async () => {
        const a = new RGA('text1', 'nodeA');
        const b = new RGA('text1', 'nodeB');

        // Both insert at position 0 concurrently
        const opA = a.insert(0, 'A');
        await new Promise((r) => setTimeout(r, 5));
        const opB = b.insert(0, 'B');

        // Apply each other's ops
        a.apply(opB);
        b.apply(opA);

        // Both must converge to the same string (order doesn't matter, convergence does)
        const resultA = a.toString();
        const resultB = b.toString();
        expect(resultA).toBe(resultB);
        // The string should contain both characters
        expect(resultA).toContain('A');
        expect(resultA).toContain('B');
        expect(resultA.length).toBe(2);
    });

    it('should converge regardless of operation order', async () => {
        const a = new RGA('text1', 'nodeA');
        const b = new RGA('text1', 'nodeB');
        const c = new RGA('text1', 'nodeC');

        // Each inserts a character at position 0
        const opA = a.insert(0, 'A');
        await new Promise((r) => setTimeout(r, 3));
        const opB = b.insert(0, 'B');
        await new Promise((r) => setTimeout(r, 3));
        const opC = c.insert(0, 'C');

        // Apply in different orders
        a.apply(opB);
        a.apply(opC);

        b.apply(opC);
        b.apply(opA);

        c.apply(opA);
        c.apply(opB);

        // All three must converge to the same string
        const rA = a.toString();
        const rB = b.toString();
        const rC = c.toString();
        expect(rA).toBe(rB);
        expect(rB).toBe(rC);
        expect(rA).toContain('A');
        expect(rA).toContain('B');
        expect(rA).toContain('C');
        expect(rA.length).toBe(3);
    });

    it('should handle interleaved typing from two users', () => {
        const a = new RGA('text1', 'nodeA');
        const b = new RGA('text1', 'nodeB');

        // A types "Hi"
        const op1 = a.insert(0, 'H');
        const op2 = a.insert(1, 'i');

        // B receives A's ops
        b.apply(op1);
        b.apply(op2);

        // B appends "!"
        const op3 = b.insert(2, '!');

        // A receives B's op
        a.apply(op3);

        expect(a.toString()).toBe('Hi!');
        expect(b.toString()).toBe('Hi!');
    });

    it('should serialize and deserialize', () => {
        const rga = new RGA('text1', 'nodeA');
        rga.insert(0, 'H');
        rga.insert(1, 'e');
        rga.insert(2, 'l');
        rga.insert(3, 'l');
        rga.insert(4, 'o');

        const json = rga.toJSON();
        const restored = RGA.fromJSON(json);
        expect(restored.toString()).toBe('Hello');
        expect(restored.id).toBe('text1');
    });

    it('should throw on out-of-bounds delete', () => {
        const rga = new RGA('text1', 'nodeA');
        expect(() => rga.delete(0)).toThrow();
    });
});
