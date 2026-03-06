import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RelayServer } from '../../server/RelayServer.js';
import { WebSocketTransport } from '../../src/net/WebSocketTransport.js';
import { GCounter } from '../../src/core/GCounter.js';
import { KeyManager } from '../../src/crypto/KeyManager.js';
import { EncryptedEnvelope } from '../../src/crypto/EncryptedEnvelope.js';
import { Operation } from '../../src/core/Operation.js';

describe('Integration: E2E Encrypted Sync', () => {
    let server;
    const PORT = 4555;

    beforeAll(async () => {
        server = new RelayServer({ port: PORT, verbose: true });
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
    });

    it('should relay encrypted operations between clients', async () => {
        const documentKey = await KeyManager.generateDocumentKey();
        const docId = 'test-doc-1';

        // Create two counters
        const counterA = new GCounter(docId, 'alice');
        const counterB = new GCounter(docId, 'bob');

        // Connect two WebSocket clients
        const clientA = new WebSocketTransport();
        const clientB = new WebSocketTransport();

        await clientA.connect(`ws://localhost:${PORT}`);
        await clientB.connect(`ws://localhost:${PORT}`);

        // Join the same room
        clientA.send({ action: 'join', roomId: docId });
        clientB.send({ action: 'join', roomId: docId });

        // Wait for join to process
        await new Promise((r) => setTimeout(r, 4000));

        // Set up receiver on client B
        const receivedOps = [];
        clientB.on('message', async (msg) => {
            if (msg.action === 'envelope' && msg.envelope) {
                try {
                    const opData = await EncryptedEnvelope.decryptOperation(msg.envelope, documentKey);
                    receivedOps.push(opData);
                    const op = Operation.fromJSON(opData);
                    counterB.apply(op);
                } catch (e) {
                    // ignore
                }
            }
        });

        // Alice increments and broadcasts encrypted op
        const op = counterA.increment(42);
        const envelope = await EncryptedEnvelope.encryptOperation(op, documentKey, docId);

        clientA.send({
            action: 'broadcast',
            roomId: docId,
            envelope,
        });

        // Wait for relay
        await new Promise((r) => setTimeout(r, 4000));

        // Verify Bob received and decrypted
        expect(receivedOps.length).toBe(1);
        expect(receivedOps[0].data.amount).toBe(42);
        expect(counterB.value()).toBe(42);
        expect(counterA.value()).toBe(42);

        // Clean up
        clientA.disconnect();
        clientB.disconnect();
    });

    it('should prove server cannot decrypt payloads', async () => {
        const documentKey = await KeyManager.generateDocumentKey();
        const wrongKey = await KeyManager.generateDocumentKey();
        const docId = 'test-doc-2';

        const counter = new GCounter(docId, 'alice');
        const op = counter.increment(100);
        const envelope = await EncryptedEnvelope.encryptOperation(op, documentKey, docId);

        // The server (or anyone without the key) cannot decrypt
        await expect(
            EncryptedEnvelope.decryptOperation(envelope, wrongKey),
        ).rejects.toThrow();

        // The ciphertext is opaque — no plaintext visible
        expect(envelope.ciphertext).not.toContain('100');
        expect(envelope.ciphertext).not.toContain('alice');
    });

    it('should handle snapshot upload and retrieval', async () => {
        const documentKey = await KeyManager.generateDocumentKey();
        const docId = 'test-doc-3';

        const counter = new GCounter(docId, 'alice');
        counter.increment(50);

        // Encrypt snapshot
        const snapshot = await EncryptedEnvelope.encryptSnapshot(
            counter.toJSON(),
            documentKey,
            docId,
        );

        // Connect and upload snapshot
        const client = new WebSocketTransport();
        await client.connect(`ws://localhost:${PORT}`);
        client.send({ action: 'join', roomId: docId });
        await new Promise((r) => setTimeout(r, 4000));

        client.send({
            action: 'upload-snapshot',
            roomId: docId,
            envelope: snapshot,
        });

        await new Promise((r) => setTimeout(r, 4000));

        // New client requests snapshot
        const client2 = new WebSocketTransport();
        await client2.connect(`ws://localhost:${PORT}`);
        client2.send({ action: 'join', roomId: docId });

        const receivedSnapshot = await new Promise((resolve) => {
            client2.on('message', (msg) => {
                if (msg.action === 'snapshot') resolve(msg.envelope);
            });
            client2.send({ action: 'request-snapshot', roomId: docId });
        });

        // Decrypt and verify
        const state = await EncryptedEnvelope.decryptSnapshot(receivedSnapshot, documentKey);
        const restored = GCounter.fromJSON(state);
        expect(restored.value()).toBe(50);

        client.disconnect();
        client2.disconnect();
    });

    it('should relay to multiple clients in same room', async () => {
        const documentKey = await KeyManager.generateDocumentKey();
        const docId = 'test-doc-4';

        const clientA = new WebSocketTransport();
        const clientB = new WebSocketTransport();
        const clientC = new WebSocketTransport();

        await clientA.connect(`ws://localhost:${PORT}`);
        await clientB.connect(`ws://localhost:${PORT}`);
        await clientC.connect(`ws://localhost:${PORT}`);

        clientA.send({ action: 'join', roomId: docId });
        clientB.send({ action: 'join', roomId: docId });
        clientC.send({ action: 'join', roomId: docId });
        await new Promise((r) => setTimeout(r, 4000));

        let bReceived = 0;
        let cReceived = 0;

        clientB.on('message', (msg) => {
            if (msg.action === 'envelope') bReceived++;
        });
        clientC.on('message', (msg) => {
            if (msg.action === 'envelope') cReceived++;
        });

        // A broadcasts
        const counter = new GCounter(docId, 'alice');
        const op = counter.increment(1);
        const envelope = await EncryptedEnvelope.encryptOperation(op, documentKey, docId);

        clientA.send({ action: 'broadcast', roomId: docId, envelope });
        await new Promise((r) => setTimeout(r, 2000));

        // Both B and C should receive it
        expect(bReceived).toBe(1);
        expect(cReceived).toBe(1);

        clientA.disconnect();
        clientB.disconnect();
        clientC.disconnect();
    });
});
