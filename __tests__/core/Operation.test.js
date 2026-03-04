import { describe, it, expect } from 'vitest';
import { Operation } from '../../src/core/Operation.js';

describe('Operation', () => {
    it('should generate deterministic opId', () => {
        const params = {
            type: 'gcounter:increment',
            crdtId: 'counter-1',
            nodeId: 'node-a',
            clock: 1,
            causalDeps: { 'node-a': 1 },
            data: { amount: 1 },
        };

        const op1 = new Operation(params);
        const op2 = new Operation(params);
        expect(op1.opId).toBe(op2.opId);
    });

    it('should produce different opIds for different data', () => {
        const base = {
            type: 'gcounter:increment',
            crdtId: 'counter-1',
            nodeId: 'node-a',
            clock: 1,
            causalDeps: { 'node-a': 1 },
        };

        const op1 = new Operation({ ...base, data: { amount: 1 } });
        const op2 = new Operation({ ...base, data: { amount: 2 } });
        expect(op1.opId).not.toBe(op2.opId);
    });

    it('should serialize and deserialize', () => {
        const op = new Operation({
            type: 'lww:set',
            crdtId: 'reg-1',
            nodeId: 'node-b',
            clock: 5,
            causalDeps: { 'node-b': 5 },
            data: { value: 'hello', timestamp: 12345 },
        });

        const json = op.toJSON();
        const restored = Operation.fromJSON(json);

        expect(restored.opId).toBe(op.opId);
        expect(restored.type).toBe(op.type);
        expect(restored.data.value).toBe('hello');
    });

    it('should accept precomputed opId', () => {
        const op = new Operation({
            type: 'test',
            crdtId: 'test-1',
            nodeId: 'n',
            clock: 1,
            causalDeps: {},
            data: {},
            opId: 'custom-id-123',
        });

        expect(op.opId).toBe('custom-id-123');
    });
});
