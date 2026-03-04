import { describe, it, expect } from 'vitest';
import { KeyRotation } from '../../src/crypto/KeyRotation.js';
import { KeyManager } from '../../src/crypto/KeyManager.js';

describe('KeyRotation', () => {
    it('should start at epoch 0', async () => {
        const key = await KeyManager.generateDocumentKey();
        const kr = new KeyRotation(key);
        expect(kr.epoch).toBe(0);
        expect(kr.currentKey).toBe(key);
    });

    it('should rotate to new epoch', async () => {
        const key = await KeyManager.generateDocumentKey();
        const kr = new KeyRotation(key);

        const { key: newKey, epoch } = await kr.rotateKey();
        expect(epoch).toBe(1);
        expect(kr.currentKey).toBe(newKey);
        expect(kr.epoch).toBe(1);
    });

    it('should retain historical keys', async () => {
        const initialKey = await KeyManager.generateDocumentKey();
        const kr = new KeyRotation(initialKey);

        await kr.rotateKey(); // epoch 1
        await kr.rotateKey(); // epoch 2

        expect(kr.getKeyForEpoch(0)).toBe(initialKey);
        expect(kr.getKeyForEpoch(1)).toBeDefined();
        expect(kr.getKeyForEpoch(2)).toBe(kr.currentKey);
        expect(kr.keyCount).toBe(3);
    });

    it('should fire rotation listeners', async () => {
        const key = await KeyManager.generateDocumentKey();
        const kr = new KeyRotation(key);

        let rotatedEpoch = null;
        kr.onRotation(async (newKey, epoch) => {
            rotatedEpoch = epoch;
        });

        await kr.rotateKey();
        expect(rotatedEpoch).toBe(1);
    });

    it('should prune old keys', async () => {
        const key = await KeyManager.generateDocumentKey();
        const kr = new KeyRotation(key);

        await kr.rotateKey(); // epoch 1
        await kr.rotateKey(); // epoch 2
        await kr.rotateKey(); // epoch 3

        kr.pruneKeys(2); // Keep keys for epoch >= 2
        expect(kr.getKeyForEpoch(0)).toBeUndefined();
        expect(kr.getKeyForEpoch(1)).toBeUndefined();
        expect(kr.getKeyForEpoch(2)).toBeDefined();
        expect(kr.getKeyForEpoch(3)).toBeDefined();
    });

    it('should allow setting key with epoch', async () => {
        const kr = new KeyRotation();
        const key = await KeyManager.generateDocumentKey();
        kr.setKey(key, 5);

        expect(kr.epoch).toBe(5);
        expect(kr.currentKey).toBe(key);
    });
});
