/**
 * Ekya Performance Benchmarks
 *
 * Measures throughput and memory usage for CRDT operations,
 * encryption/decryption, and serialization at various scales.
 *
 * Run: node benchmarks/run.js
 */
import { RGA } from '../src/core/RGA.js';
import { GCounter } from '../src/core/GCounter.js';
import { PNCounter } from '../src/core/PNCounter.js';
import { LWWMap } from '../src/core/LWWMap.js';
import { Serializer } from '../src/core/Serializer.js';
import { KeyManager } from '../src/crypto/KeyManager.js';
import { EncryptedEnvelope } from '../src/crypto/EncryptedEnvelope.js';
import { Operation } from '../src/core/Operation.js';
import crypto from 'crypto';

// ─── Utils ──────────────────────────────────────────────────
function formatNum(n) {
    return n.toLocaleString();
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function bench(name, fn, iterations = 1000) {
    // Warm up
    for (let i = 0; i < Math.min(10, iterations); i++) await fn(i);

    const start = performance.now();
    for (let i = 0; i < iterations; i++) await fn(i);
    const elapsed = performance.now() - start;

    const opsPerSec = Math.round((iterations / elapsed) * 1000);
    const avgMs = (elapsed / iterations).toFixed(3);

    console.log(`  ${name.padEnd(45)} ${formatNum(opsPerSec).padStart(10)} ops/s  ${avgMs.padStart(8)} ms/op`);
    return { name, opsPerSec, avgMs: parseFloat(avgMs), elapsed };
}

// ─── Benchmarks ─────────────────────────────────────────────

async function benchRGA() {
    console.log('\n🔤 RGA (Text CRDT)');
    console.log('─'.repeat(75));

    // Sequential inserts
    await bench('Insert 1K chars sequentially', (i) => {
        const rga = new RGA('bench', 'node1');
        for (let j = 0; j < 1000; j++) {
            rga.insert(j, 'a');
        }
    }, 50);

    // Insert into large document
    const largeRga = new RGA('bench', 'node1');
    for (let j = 0; j < 10000; j++) largeRga.insert(j, 'x');
    await bench('Insert into 10K char document', () => {
        largeRga.insert(5000, 'z');
    }, 5000);

    // Delete from large document
    const delRga = new RGA('bench', 'node1');
    for (let j = 0; j < 10000; j++) delRga.insert(j, 'x');
    await bench('Delete from 10K char document', () => {
        if (delRga.length > 100) delRga.delete(50);
    }, 5000);

    // Remote op application
    const source = new RGA('bench', 'src');
    const target = new RGA('bench', 'tgt');
    const ops = [];
    for (let j = 0; j < 1000; j++) ops.push(source.insert(j, 'a'));
    await bench('Apply 1K remote ops', () => {
        const t = new RGA('bench', 'tgt');
        for (const op of ops) t.apply(op);
    }, 50);

    // Serialization
    const serRga = new RGA('bench', 'node1');
    for (let j = 0; j < 5000; j++) serRga.insert(j, 'a');
    await bench('Serialize 5K char RGA', () => {
        serRga.toJSON();
    }, 500);

    // GC benchmark
    const gcRga = new RGA('bench', 'node1');
    for (let j = 0; j < 1000; j++) gcRga.insert(0, 'a');
    for (let j = 0; j < 500; j++) gcRga.delete(0);
    await bench('GC with 500 tombstones', () => {
        gcRga.gc();
    }, 1000);

    // Stats
    const memRga = new RGA('bench', 'node1');
    for (let j = 0; j < 10000; j++) memRga.insert(j, 'a');
    const stats = memRga.stats();
    console.log(`  📊 10K doc memory: ${stats.total} elements, ${stats.appliedOps} ops tracked`);
}

async function benchCounters() {
    console.log('\n🔢 Counters (GCounter + PNCounter)');
    console.log('─'.repeat(75));

    await bench('GCounter: 10K increments', () => {
        const c = new GCounter('bench', 'node1');
        for (let j = 0; j < 10000; j++) c.increment(1);
    }, 50);

    await bench('PNCounter: 5K inc + 5K dec', () => {
        const c = new PNCounter('bench', 'node1');
        for (let j = 0; j < 5000; j++) c.increment(1);
        for (let j = 0; j < 5000; j++) c.decrement(1);
    }, 50);

    // Multi-node convergence
    await bench('3-node convergence (100 ops each)', () => {
        const nodes = [new GCounter('b', 'n1'), new GCounter('b', 'n2'), new GCounter('b', 'n3')];
        const allOps = [];
        for (const n of nodes) {
            for (let j = 0; j < 100; j++) allOps.push(n.increment(1));
        }
        for (const n of nodes) {
            for (const op of allOps) n.apply(op);
        }
    }, 50);
}

async function benchLWWMap() {
    console.log('\n🗺️  LWWMap');
    console.log('─'.repeat(75));

    await bench('Set 1K keys', () => {
        const m = new LWWMap('bench', 'node1');
        for (let j = 0; j < 1000; j++) m.set(`key_${j}`, j);
    }, 100);

    const m = new LWWMap('bench', 'node1');
    for (let j = 0; j < 10000; j++) m.set(`key_${j}`, j);
    await bench('Get from 10K-key map', () => {
        m.get('key_5000');
    }, 100000);

    // GC benchmark
    const gcMap = new LWWMap('bench', 'node1');
    for (let j = 0; j < 1000; j++) {
        gcMap.set(`tmp_${j}`, j);
        gcMap.delete(`tmp_${j}`);
    }
    await bench('GC 1K tombstoned keys', () => {
        gcMap.gc(-1);
    }, 500);
}

async function benchCrypto() {
    console.log('\n🔐 Crypto');
    console.log('─'.repeat(75));

    // Key generation
    await bench('ECDH key pair generation', async () => {
        await KeyManager.generateIdentityKeyPair();
    }, 200);

    // Key agreement
    const kp1 = await KeyManager.generateIdentityKeyPair();
    const kp2 = await KeyManager.generateIdentityKeyPair();
    await bench('ECDH shared secret derivation', async () => {
        await KeyManager.deriveSharedSecret(kp1.privateKey, kp2.publicKey);
    }, 500);

    // Document key derivation
    const secret = await KeyManager.deriveSharedSecret(kp1.privateKey, kp2.publicKey);
    await bench('HKDF document key derivation', async () => {
        await KeyManager.deriveDocumentKey(secret, 'doc-bench');
    }, 1000);

    // Encrypt/decrypt cycle
    const docKey = await KeyManager.deriveDocumentKey(secret, 'doc-bench');
    const testOp = new Operation({
        type: 'rga:insert', crdtId: 'bench', nodeId: 'node1',
        clock: 1, causalDeps: { node1: 1 },
        data: { elemId: { nodeId: 'node1', seq: 1 }, value: 'a', afterId: null, timestamp: Date.now() },
    });

    await bench('AES-256-GCM encrypt (operation)', async () => {
        await EncryptedEnvelope.encryptOperation(testOp, docKey, 'bench', 0);
    }, 2000);

    const envelope = await EncryptedEnvelope.encryptOperation(testOp, docKey, 'bench', 0);
    await bench('AES-256-GCM decrypt (operation)', async () => {
        await EncryptedEnvelope.decryptOperation(envelope, docKey);
    }, 2000);

    // Full pipeline: operation → encrypt → decrypt → reconstruct
    await bench('Full pipeline (op→enc→dec→reconstruct)', async () => {
        const env = await EncryptedEnvelope.encryptOperation(testOp, docKey, 'bench', 0);
        await EncryptedEnvelope.decryptOperation(env, docKey);
    }, 1000);
}

async function benchSerialization() {
    console.log('\n📦 Serialization (MessagePack)');
    console.log('─'.repeat(75));

    const smallOp = { type: 'rga:insert', nodeId: 'n1', data: { value: 'a' } };
    const largeState = { elements: Array.from({ length: 5000 }, (_, i) => ({ id: i, v: 'x', d: false })) };

    await bench('Encode small operation', () => {
        Serializer.encode(smallOp);
    }, 50000);

    await bench('Decode small operation', () => {
        const buf = Serializer.encode(smallOp);
        Serializer.decode(buf);
    }, 50000);

    await bench('Encode 5K-element state', () => {
        Serializer.encode(largeState);
    }, 500);

    const largeBuf = Serializer.encode(largeState);
    await bench('Decode 5K-element state', () => {
        Serializer.decode(largeBuf);
    }, 500);

    // Size comparison
    const jsonSize = JSON.stringify(largeState).length;
    const msgpackSize = Serializer.encode(largeState).length;
    console.log(`  📊 5K state: JSON=${formatBytes(jsonSize)} MessagePack=${formatBytes(msgpackSize)} (${Math.round((1 - msgpackSize / jsonSize) * 100)}% smaller)`);
}

// ─── Run All ────────────────────────────────────────────────
async function main() {
    console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
    console.log('║                    🔐 Ekya Performance Benchmarks                        ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════════╝');

    await benchRGA();
    await benchCounters();
    await benchLWWMap();
    await benchCrypto();
    await benchSerialization();

    console.log('\n✅ All benchmarks complete.\n');
}

main().catch(console.error);
