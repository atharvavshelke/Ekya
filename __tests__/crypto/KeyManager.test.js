import { describe, it, expect } from 'vitest';
import { KeyManager } from '../../src/crypto/KeyManager.js';

describe('KeyManager', () => {
    it('should generate ECDH identity key pair', async () => {
        const keyPair = await KeyManager.generateIdentityKeyPair();
        expect(keyPair.publicKey).toBeDefined();
        expect(keyPair.privateKey).toBeDefined();
    });

    it('should derive shared secret (ECDH key agreement)', async () => {
        const alice = await KeyManager.generateIdentityKeyPair();
        const bob = await KeyManager.generateIdentityKeyPair();

        const secretA = await KeyManager.deriveSharedSecret(alice.privateKey, bob.publicKey);
        const secretB = await KeyManager.deriveSharedSecret(bob.privateKey, alice.publicKey);

        // Both should derive the same shared secret
        const a = Buffer.from(secretA);
        const b = Buffer.from(secretB);
        expect(a.equals(b)).toBe(true);
    });

    it('should derive per-document key from shared secret', async () => {
        const alice = await KeyManager.generateIdentityKeyPair();
        const bob = await KeyManager.generateIdentityKeyPair();

        const secret = await KeyManager.deriveSharedSecret(alice.privateKey, bob.publicKey);

        const key1 = await KeyManager.deriveDocumentKey(secret, 'doc-1');
        const key2 = await KeyManager.deriveDocumentKey(secret, 'doc-2');

        // Different document IDs should produce different keys
        const raw1 = Buffer.from(await KeyManager.exportKey(key1));
        const raw2 = Buffer.from(await KeyManager.exportKey(key2));
        expect(raw1.equals(raw2)).toBe(false);
    });

    it('should generate random document key', async () => {
        const key = await KeyManager.generateDocumentKey();
        expect(key).toBeDefined();

        const raw = await KeyManager.exportKey(key);
        expect(raw.byteLength).toBe(32); // 256 bits
    });

    it('should export and import public key', async () => {
        const keyPair = await KeyManager.generateIdentityKeyPair();
        const exported = await KeyManager.exportPublicKey(keyPair.publicKey);
        const imported = await KeyManager.importPublicKey(exported);

        // Verify the imported key works for ECDH
        const otherPair = await KeyManager.generateIdentityKeyPair();
        const secret1 = await KeyManager.deriveSharedSecret(otherPair.privateKey, keyPair.publicKey);
        const secret2 = await KeyManager.deriveSharedSecret(otherPair.privateKey, imported);

        expect(Buffer.from(secret1).equals(Buffer.from(secret2))).toBe(true);
    });

    it('should export and import symmetric key', async () => {
        const key = await KeyManager.generateDocumentKey();
        const exported = await KeyManager.exportKey(key);
        const imported = await KeyManager.importKey(exported);

        const exportedAgain = await KeyManager.exportKey(imported);
        expect(Buffer.from(exported).equals(Buffer.from(exportedAgain))).toBe(true);
    });

    it('should export and import via base64', async () => {
        const key = await KeyManager.generateDocumentKey();
        const b64 = await KeyManager.exportKeyToBase64(key);
        expect(typeof b64).toBe('string');

        const imported = await KeyManager.importKeyFromBase64(b64);
        const b64Again = await KeyManager.exportKeyToBase64(imported);
        expect(b64).toBe(b64Again);
    });
});
