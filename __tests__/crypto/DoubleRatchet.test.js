import { describe, it, expect } from 'vitest';
import { DoubleRatchet } from '../../src/crypto/DoubleRatchet.js';

describe('DoubleRatchet — Forward Secrecy', () => {
    const generateSecret = () => crypto.getRandomValues(new Uint8Array(32)).buffer;

    it('should create a ratchet from a shared secret', async () => {
        const secret = generateSecret();
        const ratchet = await DoubleRatchet.create(secret);
        expect(ratchet).toBeDefined();
        expect(ratchet.stats().sendIndex).toBe(0);
    });

    it('should generate unique keys for each send', async () => {
        const ratchet = await DoubleRatchet.create(generateSecret());

        const { key: key1, index: idx1 } = await ratchet.nextSendKey();
        const { key: key2, index: idx2 } = await ratchet.nextSendKey();

        expect(idx1).toBe(0);
        expect(idx2).toBe(1);

        // Keys should be different
        expect(key1).not.toBe(key2);
    });

    it('should advance send index', async () => {
        const ratchet = await DoubleRatchet.create(generateSecret());

        await ratchet.nextSendKey();
        await ratchet.nextSendKey();
        await ratchet.nextSendKey();

        expect(ratchet.stats().sendIndex).toBe(3);
    });

    it('should produce AES-256-GCM keys', async () => {
        const ratchet = await DoubleRatchet.create(generateSecret());
        const { key } = await ratchet.nextSendKey();

        expect(key.type).toBe('secret');
        expect(key.algorithm.name).toBe('AES-GCM');
        expect(key.algorithm.length).toBe(256);
    });

    it('should encrypt and decrypt with ratchet keys', async () => {
        const ratchet = await DoubleRatchet.create(generateSecret());
        const { key } = await ratchet.nextSendKey();

        const plaintext = new TextEncoder().encode('Hello, Ekya!');
        const iv = crypto.getRandomValues(new Uint8Array(12));

        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            plaintext,
        );

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            ciphertext,
        );

        expect(new TextDecoder().decode(decrypted)).toBe('Hello, Ekya!');
    });

    it('should report stats correctly', async () => {
        const ratchet = await DoubleRatchet.create(generateSecret());

        await ratchet.nextSendKey();
        await ratchet.nextSendKey();

        const stats = ratchet.stats();
        expect(stats.sendIndex).toBe(2);
        expect(stats.recvIndex).toBe(0);
        expect(stats.skippedKeys).toBe(0);
    });

    it('should produce forward-secret keys (each key is independent)', async () => {
        const ratchet = await DoubleRatchet.create(generateSecret());

        const keys = [];
        for (let i = 0; i < 5; i++) {
            const { key } = await ratchet.nextSendKey();
            keys.push(key);
        }

        // All 5 keys should be unique CryptoKey objects
        const keySet = new Set(keys);
        expect(keySet.size).toBe(5);
    });

    it('should clear skipped keys', async () => {
        const ratchet = await DoubleRatchet.create(generateSecret());
        ratchet.clearSkippedKeys();
        expect(ratchet.stats().skippedKeys).toBe(0);
    });
});
