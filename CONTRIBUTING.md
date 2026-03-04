# Contributing to Ekya

Thank you for your interest in contributing to Ekya! This document provides guidelines and information for contributors.

## 🏗️ Architecture Overview

```
src/
├── core/           # CRDTs: VectorClock, GCounter, LWWRegister, LWWMap, RGA
├── crypto/         # KeyManager, EncryptedEnvelope, KeyRotation
├── net/            # WebSocket, WebRTC, Hybrid transports, SyncProtocol
├── EkyaDocument.js # Developer-facing API
├── EkyaProvider.js # Orchestrator (encrypt → relay → decrypt)
└── index.js        # Public exports

server/             # Trustless relay server
demo/               # Interactive browser demo
__tests__/          # Vitest test suites
```

## 🚀 Getting Started

```bash
# Clone the repository
git clone https://github.com/atharvavshelke/Ekya.git
cd Ekya

# Install dependencies
npm install

# Run tests
npm test

# Start the demo
npm start
# → http://localhost:4444
```

## 🧪 Testing

All changes must pass the existing test suite:

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage
```

### Test Structure

| Directory | Covers |
|---|---|
| `__tests__/core/` | CRDT correctness, convergence, serialization, GC |
| `__tests__/crypto/` | Key derivation, encryption, rotation |
| `__tests__/integration/` | End-to-end encrypted sync through relay |

### Writing Tests

- Every CRDT must test **commutativity**, **idempotency**, and **convergence**
- Crypto tests must verify **tamper detection** and **wrong-key rejection**
- Integration tests must prove the **server cannot decrypt** payloads

## 📐 Code Style

```bash
npm run lint     # ESLint
npm run format   # Prettier
```

- ES Modules (`import`/`export`)
- Single quotes, trailing commas, 2-space indent
- JSDoc on all public methods

## 🔐 Security Guidelines

Ekya is a cryptographic framework. Security-related contributions require extra care:

1. **Never log plaintext** — The server must remain trustless
2. **Always use Web Crypto API** — No custom crypto implementations
3. **Random IVs** — Every encryption must generate a fresh 12-byte IV
4. **Constant-time comparisons** — Where timing attacks are possible
5. **Document metadata leakage** — Any unencrypted field must be justified

## 🔧 Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Write tests for your changes
4. Ensure all tests pass (`npm test`)
5. Run linting (`npm run lint`)
6. Commit with a descriptive message
7. Open a Pull Request

### Commit Message Format

```
<emoji> <type>: <description>

🧱 feat: Add PNCounter CRDT
🐛 fix: RGA convergence with null afterId
🧪 test: Add concurrent insert edge cases
📝 docs: Update security model documentation
♻️ refactor: Extract CRDT base class
🔐 security: Rotate keys on member removal
```

## 🗺️ Roadmap

Areas where contributions are especially welcome:

- **MLS Group Key Protocol** — Multi-party key agreement for large rooms
- **Forward Secrecy Ratcheting** — Per-operation key derivation
- **Rich Text CRDT** — Block-based formatting tree on top of RGA
- **PNCounter** — Positive-negative counter CRDT
- **Partial Replication** — Chunked CRDT segments for large documents
- **Tombstone Compaction** — More aggressive GC strategies
- **Performance Benchmarks** — Large document stress testing

## 📄 License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
