# 🔐 एक्य Ekya

> **E2EE Real-Time Collaborative CRDT Framework**
> *The server never sees your data.*

[![Tests](https://github.com/atharvavshelke/Ekya/actions/workflows/ci.yml/badge.svg)](https://github.com/atharvavshelke/Ekya/actions)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

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
| Custom CRDTs | ⚠️ Limited | ❌ | ✅ |
| Trustless server | ❌ | ❌ | **✅** |
| Zero dependencies on server trust | ❌ | ❌ | **✅** |

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
│  ┌────┴─────┐                          │          │
│  │ EkyaDoc  │  (Developer API)         │          │
│  └──────────┘                          │          │
└────────────────────────────────────────┼──────────┘
                                         │ Encrypted
                                         │ Opaque Blobs
                                         ▼
                              ┌──────────────────────┐
                              │  Trustless Relay      │
                              │  Server               │
                              │  • Room pub/sub       │
                              │  • Encrypted storage  │
                              │  • NEVER decrypts     │
                              └──────────────────────┘
```

### Crypto Pipeline

```
CRDT Operation → MessagePack Serialize → AES-256-GCM Encrypt → WebSocket Relay → Decrypt → Deserialize → CRDT Apply
```

**Key Management:** ECDH P-256 Key Agreement → HKDF-SHA256 Derivation → Per-document AES-256-GCM Keys

---

## 🚀 Quick Start

### Installation

```bash
npm install
```

### 1. Start the Relay Server

```bash
npm start
# or
node server/RelayServer.js
```

### 2. Use in Your Application

```javascript
import { EkyaDocument, EkyaProvider, KeyManager } from 'ekya';

// Create a collaborative text document
const doc = new EkyaDocument({
  id: 'my-document',
  type: 'text',        // 'text' | 'map' | 'counter' | 'register'
  nodeId: 'alice',
});

// Generate a document key (share this securely with collaborators)
const key = await KeyManager.generateDocumentKey();

// Connect to the relay server
const provider = new EkyaProvider({
  signalingUrl: 'ws://localhost:4444',
  documentKey: key,
  nodeId: 'alice',
});

await provider.connect(doc);

// Edit collaboratively
doc.insertText(0, 'Hello, World!');
console.log(doc.getText()); // "Hello, World!"

// Listen for remote changes
doc.on('update', () => {
  console.log('Doc updated:', doc.getText());
});

// Cursor awareness
provider.awareness.setLocalState({
  cursor: 5,
  user: 'Alice',
  color: '#ff6b6b',
});
```

### 3. Shared Counter Example

```javascript
const counter = new EkyaDocument({ id: 'votes', type: 'counter', nodeId: 'bob' });
const key = await KeyManager.generateDocumentKey();
const provider = new EkyaProvider({
  signalingUrl: 'ws://localhost:4444',
  documentKey: key,
  nodeId: 'bob',
});
await provider.connect(counter);

counter.increment(1);
console.log(counter.value()); // 1
```

### 4. Key-Value Map Example

```javascript
const config = new EkyaDocument({ id: 'settings', type: 'map', nodeId: 'carol' });
// ... connect with provider ...

config.set('theme', 'dark');
config.set('fontSize', 16);
console.log(config.get('theme')); // 'dark'
console.log(config.toObject());    // { theme: 'dark', fontSize: 16 }
```

---

## 🔌 Built-in CRDTs

| CRDT | Use Case | Convergence |
|---|---|---|
| **GCounter** | Likes, votes, page views | Sum of per-node counts |
| **LWW-Register** | Single values (status, config) | Highest timestamp wins |
| **LWW-Map** | Key-value stores, settings | Per-key LWW resolution |
| **RGA** | Collaborative text editing | Deterministic ordering |

---

## 🔐 Security Model

1. **Key Generation**: Users generate ECDH P-256 identity key pairs
2. **Key Agreement**: Two users derive a shared secret via ECDH
3. **Document Key**: HKDF-SHA256 derives per-document AES-256-GCM keys from the shared secret
4. **Operation Encryption**: Every CRDT operation is serialized (MessagePack), then encrypted (AES-256-GCM, random 12-byte IV)
5. **Relay**: The server forwards encrypted envelopes — it has ZERO access to plaintext
6. **Decryption**: Clients decrypt and apply operations locally
7. **Key Rotation**: Epoch-based rotation with encrypted snapshot anchoring for late joiners

### What the Server Sees

| Data | Visible to Server? |
|---|---|
| Document content | ❌ Never |
| Operation values | ❌ Never |
| Node IDs (in ops) | ❌ Encrypted |
| Document ID | ✅ For routing |
| Key epoch | ✅ For rotation tracking |
| Message timing | ✅ Metadata |

---

## 🧪 Testing

```bash
npm test
```

**83 tests** across 11 test suites:

- **Core CRDTs**: VectorClock, Operation, GCounter, LWWRegister, LWWMap, RGA, Serializer
- **Crypto**: KeyManager (ECDH+HKDF), EncryptedEnvelope (AES-256-GCM), KeyRotation
- **Integration**: E2E encrypted relay between simulated clients

---

## 🧩 Ecosystem

Ekya is part of a modular encrypted distributed stack:

| Project | Role |
|---|---|
| [**SecureConnect**](https://github.com/atharvavshelke/SecureConnect) | E2EE messaging & voice calls |
| [**Kalpa**](https://github.com/atharvavshelke/Kalpa) | Programmable protocol router |
| **Ekya** | E2EE collaborative state engine |

**Future**: The Ekya relay server can be replaced with a Kalpa YAML configuration, making the signaling infrastructure zero-code.

---

## 📄 License

MIT License — see [LICENSE](LICENSE).
