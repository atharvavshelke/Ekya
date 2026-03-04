import { describe, it, expect } from 'vitest';
import { Serializer } from '../../src/core/Serializer.js';

describe('Serializer', () => {
    it('should round-trip encode/decode objects', () => {
        const obj = { name: 'test', value: 42, nested: { a: [1, 2, 3] } };
        const encoded = Serializer.encode(obj);
        const decoded = Serializer.decode(encoded);
        expect(decoded).toEqual(obj);
    });

    it('should handle strings', () => {
        const encoded = Serializer.encode('hello world');
        const decoded = Serializer.decode(encoded);
        expect(decoded).toBe('hello world');
    });

    it('should handle arrays', () => {
        const arr = [1, 'two', { three: 3 }];
        const encoded = Serializer.encode(arr);
        const decoded = Serializer.decode(encoded);
        expect(decoded).toEqual(arr);
    });

    it('should produce Buffer output', () => {
        const encoded = Serializer.encode({ test: true });
        expect(Buffer.isBuffer(encoded) || encoded instanceof Uint8Array).toBe(true);
    });

    it('should round-trip via base64', () => {
        const obj = { key: 'value', data: [1, 2, 3] };
        const b64 = Serializer.encodeToBase64(obj);
        expect(typeof b64).toBe('string');
        const decoded = Serializer.decodeFromBase64(b64);
        expect(decoded).toEqual(obj);
    });

    it('should produce compact output (smaller than JSON)', () => {
        const obj = { name: 'test', value: 42, arr: [1, 2, 3, 4, 5] };
        const msgpack = Serializer.encode(obj);
        const json = Buffer.from(JSON.stringify(obj));
        expect(msgpack.length).toBeLessThan(json.length);
    });
});
