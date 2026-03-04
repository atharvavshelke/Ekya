# 🔐 एक्य Ekya

> **E2EE Real-Time Collaborative CRDT Framework**
> *The server never sees your data.*

[![Tests](https://github.com/atharvavshelke/Ekya/actions/workflows/ci.yml/badge.svg)](https://github.com/atharvavshelke/Ekya/actions)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests: 108](https://img.shields.io/badge/tests-108%20passed-green)](__tests__/)

Ekya (Sanskrit: एक्य — "unity, oneness") is a developer SDK for building **real-time collaborative applications** where the central server **never sees plaintext data**. CRDTs handle conflict-free merging across peers; E2EE ensures the relay server is completely trustless.

Built as the natural evolution of [SecureConnect](https://github.com/atharvavshelke/SecureConnect) (E2EE messaging) and [Kalpa](https://github.com/atharvavshelke/Kalpa) (programmable protocol router).

---

## ✨ Why Ekya?

Most real-time collaboration frameworks (Yjs, Automerge, ShareDB) trust the server. The server stores plaintext documents, resolves conflicts, and has full access to your data.

**Ekya inverts this.** The server is a blind relay — it forwards encrypted opaque blobs between clients and stores encrypted snapshots it can never read.

| Feature | Yjs/Automerge | Google Docs | **Ekya** |
|---|---|---|---|
| Real-time sync | ✅ | ✅ | ✅ |
| Conflict resolution | ✅ (CRDT) | ✅ (OT) | ✅ (CRDT) |
| Server sees plaintext | ⚠️ Yes | ⚠️ Yes | **🔒 Never** |
| Direct P2P mode | ⚠️ Limited | ❌ | **✅ (WebRTC)** |
| Trustless server | ❌ | ❌ | **✅** |
| Garbage collection | ⚠️ Basic | N/A | **✅** |

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────┐
│                  Client (Browser)                 │
│                                                   │
│  ┌──────────┐   ┌───────────┐   ┌──────────────┐ │
│  │   CRDT   │──▶│  Crypto   │──▶│  Transport   │ │
│  │  Engine  │◀──│  Layer    │◀──│  (WS/WebRTC) │ │
│  └──────────┘   └───────────┘   └──────┬───────┘ │
│       │                                │          │
│  ┌────┴─────┐                   ┌──────┴───────┐ │
│  │ EkyaDoc  │                   │ HybridTransp │ │
│  └──────────┘                   │ Relay → P2P  │ │
│                                 └──────────────┘ │
└────────────────────────────────────────┼──────────┘
                                         │ Encrypted
                                         │ Opaque Blobs
                                         ▼
┌────────────────────────────────────────────────────┐
│              Trustless Relay Server                │
│  • Room pub/sub   • Encrypted snapshot storage    │
│  • WebRTC signaling   • NEVER decrypts anything   │
└────────────────────────────────────────────────────┘
```

### Crypto Pipeline

```
CRDT Op → MessagePack → AES-256-GCM Encrypt → WebSocket/WebRTC → Decrypt → Deserialize → CRDT Apply
```

**Key Management:** ECDH P-256 → HKDF-SHA256 → Per-document AES-256-GCM keys → Epoch-based rotation

---

## 🚀 Quick Start

```bash
npm install
npm start         # Interactive demo at http://localhost:4444
npm test          # 108 tests across 13 suites
npm run bench     # Performance benchmarks
```

### Collaborative Text Editor

```javascript
import { EkyaDocument, EkyaProvider, KeyManager } from 'ekya';

const doc = new EkyaDocument({
  id: 'my-document',
  type: 'text',       // 'text' | 'map' | 'counter' | 'pncounter' | 'register'
  nodeId: 'alice',
});

const key = await KeyManager.generateDocumentKey();
const provider = new EkyaProvider({
  signalingUrl: 'ws://localhost:4444',
  documentKey: key,
  nodeId: 'alice',
});
await provider.connect(doc);

doc.insertText(0, 'Hello, World!');
doc.on('update', () => console.log(doc.getText()));
```

### Upvote/Downvote Counter

```javascript
const votes = new EkyaDocument({ id: 'post-votes', type: 'pncounter', nodeId: 'bob' });
// ... connect with provider ...

votes.increment(1);   // upvote
votes.decrement(1);   // downvote
console.log(votes.value()); // net score
```

### Key-Value Map

```javascript
const config = new EkyaDocument({ id: 'settings', type: 'map', nodeId: 'carol' });
config.set('theme', 'dark');
config.set('fontSize', 16);
console.log(config.toObject()); // { theme: 'dark', fontSize: 16 }
```

---

## 🔌 Built-in CRDTs

| CRDT | Use Case | Convergence | GC |
|---|---|---|---|
| **GCounter** | Likes, page views | Sum of per-node counts | Op pruning |
| **PNCounter** | Votes, inventory | Increment - Decrement | Op pruning |
| **LWW-Register** | Status, config | Highest timestamp wins | — |
| **LWW-Map** | Key-value stores | Per-key LWW resolution | Time-based tombstone expiry |
| **RGA** | Collaborative text | Deterministic ordering | Reference-safe tombstone GC |

---

## 📊 Performance

Run: `npm run bench`

| Operation | Throughput |
|---|---|
| RGA insert (10K doc) | **18,186 ops/s** |
| RGA GC (500 tombstones) | **90,015 ops/s** |
| LWWMap get (10K keys) | **11.2M ops/s** |
| AES-256-GCM encrypt | **29,827 ops/s** |
| AES-256-GCM decrypt | **29,271 ops/s** |
| Full encrypt↔decrypt | **15,456 ops/s** |
| ECDH key generation | **14,459 ops/s** |
| MessagePack vs JSON | **47% smaller** |

---

## 🔐 Security Model

| Layer | Algorithm | Details |
|---|---|---|
| Key Agreement | ECDH P-256 | Peer-to-peer shared secret |
| Key Derivation | HKDF-SHA256 | Per-document symmetric key |
| Encryption | AES-256-GCM | Authenticated, random 12-byte IV |
| Key Rotation | Epoch-based | Forward secrecy at epoch boundaries |

**What the Server Sees:** Document IDs (routing), key epochs, message timing. **Never:** content, operation values, node identities.

See [SECURITY.md](SECURITY.md) for the full threat model, key lifecycle, and vulnerability disclosure process.

---

## 📡 Transport Modes

| Transport | Latency | NAT Traversal | Use Case |
|---|---|---|---|
| **WebSocket** (relay) | Medium | ✅ Always works | Default, reliable |
| **WebRTC** (P2P) | Low | Needs STUN/TURN | Direct peer-to-peer |
| **Hybrid** (auto) | Best | ✅ Fallback | Relay-first, auto-upgrade to P2P |

```javascript
import { HybridTransport, WebSocketTransport, WebRTCTransport } from 'ekya';

// Automatic: starts with relay, upgrades to P2P when possible
const transport = new HybridTransport({ nodeId: 'alice', wsTransport, rtcTransport });
transport.send(message); // Uses best available channel
```

---

## 🧪 Testing

```bash
npm test                  # 108 tests, 13 suites
npm run test:watch        # Watch mode
npm run test:coverage     # Coverage report
```

| Suite | Tests | Covers |
|---|---|---|
| VectorClock | 9 | Causal ordering, merge, comparison |
| Operation | 4 | Deterministic SHA-256 opId |
| GCounter | 11 | Increment, dedup, convergence |
| PNCounter | 13 | Increment, decrement, negative values |
| LWWRegister | 7 | Set, tie-breaking |
| LWWMap | 9 | Set, delete, tombstones |
| RGA | 14 | Insert, delete, concurrent convergence |
| GarbageCollection | 12 | Tombstone GC, op pruning |
| Serializer | 6 | MessagePack encode/decode |
| KeyManager | 7 | ECDH, HKDF, key export/import |
| EncryptedEnvelope | 6 | Encrypt/decrypt, tamper detection |
| KeyRotation | 6 | Epoch rotation, history |
| E2E Integration | 4 | Full encrypted relay sync |

---

## 🧩 Ecosystem

Ekya is part of a modular encrypted distributed stack:

| Project | Role |
|---|---|
| [**SecureConnect**](https://github.com/atharvavshelke/SecureConnect) | E2EE messaging & voice calls |
| [**Kalpa**](https://github.com/atharvavshelke/Kalpa) | Programmable protocol router |
| **Ekya** | E2EE collaborative state engine |

---

## 🗺️ Roadmap

- [ ] MLS Group Key Protocol (multi-party key agreement)
- [ ] Double Ratchet forward secrecy
- [ ] Rich text CRDT (block-based formatting)
- [ ] Partial replication (chunked CRDT segments)
- [ ] Kalpa integration (YAML-configured relay)

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

---

## 📄 License

MIT License — see [LICENSE](LICENSE).
