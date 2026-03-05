import { webcrypto } from 'crypto';
import { Serializer } from '../core/Serializer.js';

const crypto = webcrypto;

/**
 * EncryptedEnvelope — Wraps CRDT operations and snapshots in encrypted containers.
 *
 * Each envelope uses AES-256-GCM with a random 12-byte IV.
 * The envelope structure:
 *   {
 *     iv:          base64 string (12 bytes)
 *     ciphertext:  base64 string (encrypted msgpack payload)
 *     tag:         (included in ciphertext by GCM)
 *     epoch:       number (key rotation epoch)
 *     documentId:  string (unencrypted — intentional for v1 routing)
 *     type:        'operation' | 'snapshot'
 *     timestamp:   number (when the envelope was created)
 *   }
 *
 * NOTE on metadata leakage (v1 design decision):
 *   - documentId, epoch, and type are plaintext for server routing.
 *   - The server needs documentId to route to the correct room.
 *   - The actual CRDT operation data (values, nodeIds, clocks) is encrypted.
 *   - A future version could encrypt routing metadata with a room-level key.
 */
export class EncryptedEnvelope {
    /**
     * Encrypt a CRDT operation.
     * @param {import('../core/Operation.js').Operation} operation
     * @param {CryptoKey} documentKey - AES-256-GCM key
     * @param {string} documentId
     * @param {number} [epoch=0] - Key rotation epoch
     * @returns {Promise<object>} Encrypted envelope
     */
    static async encryptOperation(operation, documentKey, documentId, epoch = 0) {
        const payload = Serializer.encode(operation.toJSON());

        // Tier 1 Metadata fix: Fixed-size envelope padding with length prefix
        const CHUNK_SIZE = 512;
        const rawLength = 4 + payload.length; // 4 bytes for Uint32 length
        const remainder = rawLength % CHUNK_SIZE;
        const padLength = remainder === 0 ? 0 : CHUNK_SIZE - remainder;

        const plaintext = new Uint8Array(rawLength + padLength);
        new DataView(plaintext.buffer, plaintext.byteOffset).setUint32(0, payload.length, true);
        plaintext.set(payload, 4);

        if (padLength > 0) {
            crypto.getRandomValues(new Uint8Array(plaintext.buffer, plaintext.byteOffset + rawLength, padLength));
        }

        const iv = crypto.getRandomValues(new Uint8Array(12));

        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            documentKey,
            plaintext,
        );

        return {
            iv: Buffer.from(iv).toString('base64'),
            ciphertext: Buffer.from(ciphertext).toString('base64'),
            epoch,
            documentId,
            type: 'operation',
            timestamp: Date.now(),
        };
    }

    /**
     * Generate a cryptographic dummy envelope indistinguishable from a real operation.
     * @param {CryptoKey} documentKey
     * @param {string} documentId
     * @param {number} [epoch=0]
     * @returns {Promise<object>}
     */
    static async encryptDummy(documentKey, documentId, epoch = 0) {
        // Real padded operations are exactly 512 + 4 = 516 bytes (before encryption)
        const CHUNK_SIZE = 512;
        const plaintext = new Uint8Array(CHUNK_SIZE + 4);
        crypto.getRandomValues(plaintext);

        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            documentKey,
            plaintext,
        );

        return {
            iv: Buffer.from(iv).toString('base64'),
            ciphertext: Buffer.from(ciphertext).toString('base64'),
            epoch,
            documentId,
            type: 'dummy',
            timestamp: Date.now(),
        };
    }

    /**
     * Decrypt an encrypted operation envelope.
     * @param {object} envelope
     * @param {CryptoKey} documentKey
     * @returns {Promise<object>} Decrypted operation data (plain object)
     */
    static async decryptOperation(envelope, documentKey) {
        const iv = new Uint8Array(Buffer.from(envelope.iv, 'base64'));
        const ciphertext = Buffer.from(envelope.ciphertext, 'base64');

        const plaintextBuf = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            documentKey,
            ciphertext,
        );

        // Extract actual payload using length prefix (skipping the random padding)
        const dv = new DataView(plaintextBuf);
        const payloadLength = dv.getUint32(0, true);
        const payload = new Uint8Array(plaintextBuf, 4, payloadLength);

        return Serializer.decode(payload);
    }

    /**
     * Encrypt a full CRDT state snapshot.
     * @param {object} state - CRDT state (from toJSON())
     * @param {CryptoKey} documentKey
     * @param {string} documentId
     * @param {number} [epoch=0]
     * @returns {Promise<object>} Encrypted snapshot envelope
     */
    static async encryptSnapshot(state, documentKey, documentId, epoch = 0) {
        const payload = Serializer.encode(state);

        // Tier 1 Metadata fix: Fixed-size padding (use larger 4KB chunks for snapshots to hide doc size)
        const CHUNK_SIZE = 4096;
        const rawLength = 4 + payload.length;
        const remainder = rawLength % CHUNK_SIZE;
        const padLength = remainder === 0 ? 0 : CHUNK_SIZE - remainder;

        const plaintext = new Uint8Array(rawLength + padLength);
        new DataView(plaintext.buffer, plaintext.byteOffset).setUint32(0, payload.length, true);
        plaintext.set(payload, 4);

        if (padLength > 0) {
            crypto.getRandomValues(new Uint8Array(plaintext.buffer, plaintext.byteOffset + rawLength, padLength));
        }

        const iv = crypto.getRandomValues(new Uint8Array(12));

        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            documentKey,
            plaintext,
        );

        return {
            iv: Buffer.from(iv).toString('base64'),
            ciphertext: Buffer.from(ciphertext).toString('base64'),
            epoch,
            documentId,
            type: 'snapshot',
            timestamp: Date.now(),
        };
    }

    /**
     * Decrypt a snapshot envelope.
     * @param {object} envelope
     * @param {CryptoKey} documentKey
     * @returns {Promise<object>} Decrypted CRDT state
     */
    static async decryptSnapshot(envelope, documentKey) {
        const iv = new Uint8Array(Buffer.from(envelope.iv, 'base64'));
        const ciphertext = Buffer.from(envelope.ciphertext, 'base64');

        const plaintextBuf = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            documentKey,
            ciphertext,
        );

        // Extract actual payload using length prefix
        const dv = new DataView(plaintextBuf);
        const payloadLength = dv.getUint32(0, true);
        const payload = new Uint8Array(plaintextBuf, 4, payloadLength);

        return Serializer.decode(payload);
    }

    /**
     * Verify that an envelope has the expected structure.
     * Does NOT decrypt — useful for server-side validation.
     * @param {object} envelope
     * @returns {boolean}
     */
    static isValid(envelope) {
        if (!envelope || typeof envelope !== 'object') return false;
        return (
            typeof envelope.iv === 'string' &&
            typeof envelope.ciphertext === 'string' &&
            typeof envelope.epoch === 'number' &&
            typeof envelope.documentId === 'string' &&
            (envelope.type === 'operation' || envelope.type === 'snapshot') &&
            typeof envelope.timestamp === 'number'
        );
    }
}
