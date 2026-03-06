import { webcrypto } from 'crypto';

const crypto = webcrypto;

/**
 * KeyManager — Identity keys and document key management.
 *
 * Uses ECDH P-256 for key agreement, HKDF-SHA256 for key derivation,
 * and AES-256-GCM for symmetric encryption. All via Web Crypto API
 * for cross-environment compatibility (Node.js + browser).
 *
 * Key hierarchy:
 *   Identity Key Pair (ECDH P-256) — long-term, per-user
 *     └→ Shared Secret (ECDH agreement between two users)
 *         └→ Document Key (HKDF derived, per-document, AES-256-GCM)
 */
export class KeyManager {
    /**
     * Generate an ECDH P-256 identity key pair.
     * @returns {Promise<{publicKey: CryptoKey, privateKey: CryptoKey}>}
     */
    static async generateIdentityKeyPair() {
        return await crypto.subtle.generateKey(
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            ['deriveKey', 'deriveBits'],
        );
    }

    /**
     * Derive a shared secret between two ECDH key pairs.
     * @param {CryptoKey} privateKey - Local private key
     * @param {CryptoKey} publicKey - Remote public key
     * @returns {Promise<ArrayBuffer>} 256-bit shared secret
     */
    static async deriveSharedSecret(privateKey, publicKey) {
        return await crypto.subtle.deriveBits(
            { name: 'ECDH', public: publicKey },
            privateKey,
            256,
        );
    }

    /**
     * Derive a per-document AES-256-GCM key from a shared secret.
     * Uses HKDF-SHA256 with the documentId as salt.
     * @param {ArrayBuffer} sharedSecret
     * @param {string} documentId
     * @returns {Promise<CryptoKey>}
     */
    static async deriveDocumentKey(sharedSecret, documentId) {
        // Import shared secret as HKDF base key
        const baseKey = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, [
            'deriveKey',
        ]);

        const encoder = new TextEncoder();
        return await crypto.subtle.deriveKey(
            {
                name: 'HKDF',
                hash: 'SHA-256',
                salt: encoder.encode(documentId),
                info: encoder.encode('ekya-document-key-v1'),
            },
            baseKey,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt'],
        );
    }

    /**
     * Generate a random AES-256-GCM document key (for initial document creation).
     * @returns {Promise<CryptoKey>}
     */
    static async generateDocumentKey() {
        return await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
            'encrypt',
            'decrypt',
        ]);
    }



    /**
     * Export a public key to raw bytes.
     * @param {CryptoKey} publicKey
     * @returns {Promise<ArrayBuffer>}
     */
    static async exportPublicKey(publicKey) {
        return await crypto.subtle.exportKey('raw', publicKey);
    }

    /**
     * Import a public key from raw bytes.
     * @param {ArrayBuffer} rawKey
     * @returns {Promise<CryptoKey>}
     */
    static async importPublicKey(rawKey) {
        return await crypto.subtle.importKey(
            'raw',
            rawKey,
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            [],
        );
    }

    /**
     * Export a symmetric key to raw bytes.
     * @param {CryptoKey} key
     * @returns {Promise<ArrayBuffer>}
     */
    static async exportKey(key) {
        return await crypto.subtle.exportKey('raw', key);
    }

    /**
     * Import a symmetric AES-256-GCM key from raw bytes.
     * @param {ArrayBuffer} rawKey
     * @returns {Promise<CryptoKey>}
     */
    static async importKey(rawKey) {
        return await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM', length: 256 }, true, [
            'encrypt',
            'decrypt',
        ]);
    }

    /**
     * Export key to base64 string (for storage/transport).
     * @param {CryptoKey} key
     * @returns {Promise<string>}
     */
    static async exportKeyToBase64(key) {
        const raw = await crypto.subtle.exportKey('raw', key);
        return Buffer.from(raw).toString('base64');
    }

    /**
     * Import key from base64 string.
     * @param {string} base64
     * @param {'ECDH'|'AES-GCM'} [type='AES-GCM']
     * @returns {Promise<CryptoKey>}
     */
    static async importKeyFromBase64(base64, type = 'AES-GCM') {
        const raw = Buffer.from(base64, 'base64');
        if (type === 'ECDH') {
            return await crypto.subtle.importKey(
                'raw',
                raw,
                { name: 'ECDH', namedCurve: 'P-256' },
                true,
                [],
            );
        }
        return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, [
            'encrypt',
            'decrypt',
        ]);
    }
}
