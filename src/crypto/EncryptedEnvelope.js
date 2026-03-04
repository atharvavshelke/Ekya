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
        const plaintext = Serializer.encode(operation.toJSON());
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
     * Decrypt an encrypted operation envelope.
     * @param {object} envelope
     * @param {CryptoKey} documentKey
     * @returns {Promise<object>} Decrypted operation data (plain object)
     */
    static async decryptOperation(envelope, documentKey) {
        const iv = new Uint8Array(Buffer.from(envelope.iv, 'base64'));
        const ciphertext = Buffer.from(envelope.ciphertext, 'base64');

        const plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            documentKey,
            ciphertext,
        );

        return Serializer.decode(new Uint8Array(plaintext));
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
        const plaintext = Serializer.encode(state);
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

        const plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            documentKey,
            ciphertext,
        );

        return Serializer.decode(new Uint8Array(plaintext));
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
