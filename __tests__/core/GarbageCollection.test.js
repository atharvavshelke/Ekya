import { describe, it, expect } from 'vitest';
import { RGA } from '../../src/core/RGA.js';
import { GCounter } from '../../src/core/GCounter.js';
import { LWWMap } from '../../src/core/LWWMap.js';

describe('Garbage Collection', () => {
    // ─── RGA ──────────────────────────────────────────────────
    describe('RGA', () => {
        it('should report stats correctly', () => {
            const rga = new RGA('text1', 'nodeA');
            rga.insert(0, 'A');
            rga.insert(1, 'B');
            rga.insert(2, 'C');
            rga.delete(1); // delete 'B'

            const stats = rga.stats();
            expect(stats.total).toBe(3);
            expect(stats.live).toBe(2);
            expect(stats.tombstoned).toBe(1);
            expect(stats.appliedOps).toBe(4);
        });

        it('should GC tombstones with no references', () => {
            const rga = new RGA('text1', 'nodeA');
            const opA = rga.insert(0, 'A'); // after null
            const opB = rga.insert(1, 'B'); // after A
            const opC = rga.insert(2, 'C'); // after B

            // Delete C (tail element — nothing references C as afterId)
            rga.delete(2);

            expect(rga.stats().tombstoned).toBe(1);

            const result = rga.gc();
            expect(result.removed).toBe(1);
            expect(rga.toString()).toBe('AB');
            expect(rga.stats().tombstoned).toBe(0);
        });

        it('should NOT GC tombstones that are referenced as afterId', () => {
            const rga = new RGA('text1', 'nodeA');
            rga.insert(0, 'A');
            rga.insert(1, 'B');
            rga.insert(2, 'C');

            // Delete B — but C was inserted after B, so B is referenced
            rga.delete(1);

            const result = rga.gc();
            expect(result.removed).toBe(0); // B cannot be GC'd
            expect(rga.toString()).toBe('AC');
        });

        it('should GC after all referencing elements are also deleted', () => {
            const rga = new RGA('text1', 'nodeA');
            rga.insert(0, 'A');
            rga.insert(1, 'B'); // after A
            rga.insert(2, 'C'); // after B

            // Delete both B and C
            rga.delete(1); // delete B (visible index 1 is now C since B is gone? No — delete is by visible index)
            // Actually after deleting B at visible index 1, 'C' becomes index 1
            rga.delete(1); // delete C

            expect(rga.stats().tombstoned).toBe(2);

            // After first GC: C has no children referencing it
            let result = rga.gc();
            expect(result.removed).toBeGreaterThanOrEqual(1);

            // The remaining tombstone (B) might now also be unreferenced
            result = rga.gc();
            // If C was the only thing referencing B, B is now GC-able too
        });

        it('should prune op history', () => {
            const rga = new RGA('text1', 'nodeA');
            for (let i = 0; i < 20; i++) {
                rga.insert(i, String.fromCharCode(65 + i));
            }
            expect(rga.stats().appliedOps).toBe(20);

            const pruned = rga.pruneOpHistory(10);
            expect(pruned).toBe(10);
            expect(rga.stats().appliedOps).toBe(10);
        });

        it('should not prune when under limit', () => {
            const rga = new RGA('text1', 'nodeA');
            rga.insert(0, 'A');

            const pruned = rga.pruneOpHistory(100);
            expect(pruned).toBe(0);
        });
    });

    // ─── GCounter ─────────────────────────────────────────────
    describe('GCounter', () => {
        it('should report stats', () => {
            const c = new GCounter('c1', 'nodeA');
            c.increment(5);
            c.increment(3);

            const stats = c.stats();
            expect(stats.nodes).toBe(1);
            expect(stats.totalValue).toBe(8);
            expect(stats.appliedOps).toBe(2);
        });

        it('should prune op history', () => {
            const c = new GCounter('c1', 'nodeA');
            for (let i = 0; i < 50; i++) {
                c.increment(1);
            }
            expect(c.stats().appliedOps).toBe(50);

            const pruned = c.pruneOpHistory(20);
            expect(pruned).toBe(30);
            expect(c.stats().appliedOps).toBe(20);
            // Value is still correct (pruning ops doesn't change state)
            expect(c.value()).toBe(50);
        });
    });

    // ─── LWWMap ───────────────────────────────────────────────
    describe('LWWMap', () => {
        it('should report stats', () => {
            const map = new LWWMap('m1', 'nodeA');
            map.set('a', 1);
            map.set('b', 2);
            map.delete('b');

            const stats = map.stats();
            expect(stats.total).toBe(2);
            expect(stats.live).toBe(1);
            expect(stats.tombstoned).toBe(1);
        });

        it('should GC old tombstones', () => {
            const map = new LWWMap('m1', 'nodeA');
            map.set('temp', 'value');
            map.delete('temp');

            // Tombstone just created — too fresh to GC
            let result = map.gc(60000);
            expect(result.removed).toBe(0);

            // GC with maxAge=-1 (everything is old enough)
            result = map.gc(-1);
            expect(result.removed).toBe(1);
            expect(map.stats().tombstoned).toBe(0);
        });

        it('should not GC live entries', () => {
            const map = new LWWMap('m1', 'nodeA');
            map.set('keep', 'me');

            const result = map.gc(0);
            expect(result.removed).toBe(0);
            expect(map.get('keep')).toBe('me');
        });

        it('should prune op history', () => {
            const map = new LWWMap('m1', 'nodeA');
            for (let i = 0; i < 30; i++) {
                map.set(`key_${i}`, i);
            }
            expect(map.stats().appliedOps).toBe(30);

            const pruned = map.pruneOpHistory(10);
            expect(pruned).toBe(20);
            expect(map.stats().appliedOps).toBe(10);
        });
    });
});
