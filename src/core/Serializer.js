import { pack, unpack } from 'msgpackr';

/**
 * Serializer — Binary serialization using MessagePack.
 *
 * Compact, fast, and schema-less. Used to serialize CRDT operations
 * and state before encryption. MessagePack produces significantly
 * smaller payloads than JSON for real-time sync.
 */
export class Serializer {
    /**
     * Encode a JavaScript object to a Buffer using MessagePack.
     * @param {*} obj
     * @returns {Buffer}
     */
    static encode(obj) {
        return pack(obj);
    }

    /**
     * Decode a Buffer back into a JavaScript object.
     * @param {Buffer|Uint8Array} buffer
     * @returns {*}
     */
    static decode(buffer) {
        return unpack(buffer);
    }

    /**
     * Encode to a base64 string (useful for text-based transport).
     * @param {*} obj
     * @returns {string}
     */
    static encodeToBase64(obj) {
        const buffer = pack(obj);
        return Buffer.from(buffer).toString('base64');
    }

    /**
     * Decode from a base64 string.
     * @param {string} base64
     * @returns {*}
     */
    static decodeFromBase64(base64) {
        const buffer = Buffer.from(base64, 'base64');
        return unpack(buffer);
    }
}
