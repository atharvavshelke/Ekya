import { describe, it, expect } from 'vitest';
import { EncryptedEnvelope } from '../../src/crypto/EncryptedEnvelope.js';
import { KeyManager } from '../../src/crypto/KeyManager.js';
import { Operation } from '../../src/core/Operation.js';

describe('EncryptedEnvelope', () => {
    let documentKey;

    beforeEach(async () => {
        documentKey = await KeyManager.generateDocumentKey();
    });

    it('should encrypt and decrypt an operation (round-trip)', async () => {
        const op = new Operation({
            type: 'gcounter:increment',
            crdtId: 'counter-1',
            nodeId: 'node-a',
            clock: 1,
            causalDeps: { 'node-a': 1 },
            data: { amount: 5 },
        });

        const envelope = await EncryptedEnvelope.encryptOperation(op, documentKey, 'doc-1', 0);

        expect(envelope.iv).toBeDefined();
        expect(envelope.ciphertext).toBeDefined();
        expect(envelope.documentId).toBe('doc-1');
        expect(envelope.type).toBe('operation');
        expect(envelope.epoch).toBe(0);

        const decrypted = await EncryptedEnvelope.decryptOperation(envelope, documentKey);
        expect(decrypted.opId).toBe(op.opId);
        expect(decrypted.data.amount).toBe(5);
    });

    it('should encrypt and decrypt a snapshot (round-trip)', async () => {
        const state = {
            id: 'counter-1',
            nodeId: 'node-a',
            counts: { 'node-a': 10 },
            clock: { 'node-a': 3 },
        };

        const envelope = await EncryptedEnvelope.encryptSnapshot(state, documentKey, 'doc-1', 2);

        expect(envelope.type).toBe('snapshot');
        expect(envelope.epoch).toBe(2);

        const decrypted = await EncryptedEnvelope.decryptSnapshot(envelope, documentKey);
        expect(decrypted.counts['node-a']).toBe(10);
    });

    it('should fail decryption with wrong key', async () => {
        const op = new Operation({
            type: 'lww:set',
            crdtId: 'reg-1',
            nodeId: 'node-a',
            clock: 1,
            causalDeps: {},
            data: { value: 'secret' },
        });

        const envelope = await EncryptedEnvelope.encryptOperation(op, documentKey, 'doc-1');
        const wrongKey = await KeyManager.generateDocumentKey();

        await expect(
            EncryptedEnvelope.decryptOperation(envelope, wrongKey),
        ).rejects.toThrow();
    });

    it('should produce different ciphertext for same plaintext (random IV)', async () => {
        const op = new Operation({
            type: 'test',
            crdtId: 'c',
            nodeId: 'n',
            clock: 1,
            causalDeps: {},
            data: { x: 1 },
        });

        const env1 = await EncryptedEnvelope.encryptOperation(op, documentKey, 'doc-1');
        const env2 = await EncryptedEnvelope.encryptOperation(op, documentKey, 'doc-1');

        // Different IVs = different ciphertext (semantic security)
        expect(env1.iv).not.toBe(env2.iv);
        expect(env1.ciphertext).not.toBe(env2.ciphertext);
    });

    it('should validate envelope structure', () => {
        expect(EncryptedEnvelope.isValid({
            iv: 'abc',
            ciphertext: 'xyz',
            epoch: 0,
            documentId: 'doc-1',
            type: 'operation',
            timestamp: Date.now(),
        })).toBe(true);

        expect(EncryptedEnvelope.isValid(null)).toBe(false);
        expect(EncryptedEnvelope.isValid({ iv: 'abc' })).toBe(false);
    });

    it('should fail on tampered ciphertext', async () => {
        const op = new Operation({
            type: 'test',
            crdtId: 'c',
            nodeId: 'n',
            clock: 1,
            causalDeps: {},
            data: { value: 'authentic' },
        });

        const envelope = await EncryptedEnvelope.encryptOperation(op, documentKey, 'doc-1');

        // Tamper with the ciphertext
        const tampered = {
            ...envelope,
            ciphertext: envelope.ciphertext.replace(/[A-Za-z]/, (c) =>
                c === 'A' ? 'B' : 'A',
            ),
        };

        await expect(
            EncryptedEnvelope.decryptOperation(tampered, documentKey),
        ).rejects.toThrow();
    });
});
