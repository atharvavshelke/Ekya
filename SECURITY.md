# Security Policy

## 🔐 Ekya Security Model

Ekya is a **zero-knowledge collaborative framework**. The security model is built on a fundamental invariant:

> **The relay server NEVER possesses the keys to decrypt document content.**

### Cryptographic Primitives

| Primitive | Algorithm | Purpose |
|---|---|---|
| Key Agreement | ECDH P-256 | Peer-to-peer shared secret derivation |
| Key Derivation | HKDF-SHA256 | Per-document symmetric key derivation |
| Symmetric Encryption | AES-256-GCM | Authenticated encryption of operations/snapshots |
| Hashing | SHA-256 | Operation ID generation for deduplication |
| Random IV | 12-byte random | Fresh IV per encryption (semantic security) |

### Threat Model

#### What Ekya Protects Against

- ✅ **Compromised server** — The server only forwards opaque ciphertext
- ✅ **Network eavesdropping** — All operations are encrypted end-to-end
- ✅ **Replay attacks** — Operation deduplication via deterministic opId
- ✅ **Tampering** — AES-GCM provides authenticated encryption (AEAD)
- ✅ **Key compromise (per-epoch)** — Key rotation limits blast radius

#### What Ekya Does NOT Protect Against (v1)

- ⚠️ **Metadata leakage** — Document ID, epoch, message timing, and participant IPs are visible to the server
- ⚠️ **Compromised client** — If a peer's device is compromised, they have the decryption key
- ⚠️ **Traffic analysis** — Message frequency and size patterns are observable
- ⚠️ **Global passive adversary** — No onion routing or mixnet protection

### Key Lifecycle

```
1. ECDH Key Pair Generation (per-node, once)
   └── crypto.subtle.generateKey('ECDH', P-256)

2. Shared Secret Derivation (per-peer-pair)
   └── crypto.subtle.deriveBits(peerPublicKey, myPrivateKey)

3. Document Key Derivation (per-document, per-epoch)
   └── HKDF(sharedSecret, salt=documentId) → AES-256-GCM key

4. Key Rotation (epoch-based)
   └── New epoch → New HKDF derivation
   └── Historical keys retained for decrypting old messages
   └── Late joiners get current key + snapshot (never old keys)
```

### Encryption Envelope

Every operation transmitted through the relay is wrapped in an `EncryptedEnvelope`:

```javascript
{
  // UNENCRYPTED (metadata — intentional for routing)
  documentId: "doc-123",
  epoch: 3,
  type: "operation",
  timestamp: 1709590000000,

  // ENCRYPTED (opaque to server)
  iv: "base64...",           // 12-byte random IV
  ciphertext: "base64...",   // AES-256-GCM encrypted payload
  // GCM tag is appended to ciphertext (16 bytes)
}
```

### Design Decisions

1. **Operation-level encryption** (not transport-level): Each CRDT operation is independently encrypted, allowing fine-grained key rotation without re-encrypting the entire document.

2. **Epoch-based keys** (not ratcheting): Simpler than Signal's double-ratchet but provides forward secrecy at epoch boundaries. Trade-off: within an epoch, key compromise exposes all ops.

3. **Web Crypto API** (not custom crypto): All cryptographic operations use the browser/Node.js [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API), which is audited and hardware-accelerated.

4. **Awareness is unencrypted**: Cursor positions and presence data are sent in plaintext. This is a deliberate trade-off for latency — cursor data has minimal privacy value.

## 🚨 Reporting a Vulnerability

If you discover a security vulnerability in Ekya, please report it responsibly:

1. **DO NOT** open a public issue
2. Email: **atharvavshelke [at] pm.me**
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will acknowledge receipt within 48 hours and provide an initial assessment within 7 days.

## 🔮 Future Security Enhancements

| Feature | Status | Description |
|---|---|---|
| MLS Group Keys | Planned | Tree-based multi-party key agreement |
| Double Ratchet | Planned | Per-operation forward secrecy |
| Encrypted Awareness | Considered | Encrypt cursor/presence data |
| Metadata Padding | Considered | Fixed-size messages to resist traffic analysis |
| Key Pinning | Considered | Prevent MITM on key exchange |

## Supported Versions

| Version | Security Updates |
|---|---|
| 0.1.x | ✅ Active |
