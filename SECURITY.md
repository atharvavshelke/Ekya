# Ekya Security Architecture

## 🛡️ Threat Model

Ekya is engineered as a **Dissident-Grade End-to-End Encrypted (E2EE) Collaborative Framework**. The core architectural assumption is that the relay server is completely untrusted and potentially malicious. The relay is treated as a "blind bit-pipeliner" whose sole responsibility is routing binary data, with zero visibility into user content or activity patterns.

### What We Protect Against:
✅ **Content Eavesdropping**: Total E2EE via Double Ratcheting and AES-256-GCM ensures that without the synchronized `documentKey`, the relay server and any interceptors see only opaque blobs.
✅ **Traffic Analysis & Profiling**: Cover traffic patterns (constant-frequency padded packets with exponential jitter) hide the distinction between active typing and idle presence, mitigating Hidden Markov Model (HMM) analysis.
✅ **Replay Attacks**: Sequence filtering via Lamport Clocks and time-windowed deduplication explicitly guarantees that network actors or malicious relays cannot replay past events.
✅ **Snapshot Poisoning**: "First Peer" logic performs an out-of-band cryptographic `expectedGenesisHash` verification, and WebRTC P2P Gossip verifies snapshot consensus, negating malicious empty-room takeovers.
✅ **XSS Injection**: The user interface bridge strictly applies DOM sanitization (`escapeHTML`) across text blocks, counter logic, and traffic logging interfaces to prevent cross-site scripting from authenticated rogue peers.

### What We DO NOT Protect Against (Known Limitations):
❌ **Network-Layer IP Tracking**: Ekya does **not** anonymize your IP address relative to the relay server. If you require absolute anonymity from your ISP or the relay host, you must tunnel your Ekya traffic through Tor or a trusted VPN.
❌ **Compromised Client Devices**: If an adversary gains physical or deep persistent access to your client machine, they can extract the `documentKey` from memory and decrypt the session natively.
❌ **Quantum Cryptanalysis**: `KeyManager.js` relies on ECDH P-256 for symmetric key agreement, which is not post-quantum secure.
❌ **Social Engineering**: Ekya cannot protect you if you voluntarily share your URL payload (which usually includes the decryption credentials) with a hostile entity.

---

## 🔒 Cryptographic Guarantees (The Stack)

1. **TreeKEM**: For N-party group key negotiation without centralized trust.
2. **Double Ratchet Algorithm**: Provides ironclad Forward Secrecy and Post-Compromise Security upon every message exchange epoch.
3. **AES-256-GCM**: Symmetrical authenticated encryption handles all envelopes, payloads, and snapshots natively within the browser's WebCrypto APIs.
4. **Byzantine Fault Tolerance**: CRDT resolution strategies across Rich Text, RGA, and Counters deterministically converge regardless of network delivery latency.

---

## 🚫 Trustless Relay Properties (Option C Architecture)

Following the formal Pre-Audit Hardening review (Phase 6), **Ekya intentionally removed Room-Level Access Control (`authToken` challenge-response).**

Any client may technically establish a WebSocket connection to any room ID on the relay. This enforces our foundational premise: **Content security relies entirely on cryptography.**

- A rogue observer ("Ghost Listener") joining the relay room will receive meaningless strings of hex ciphertext padded to 516 bytes.
- The observer cannot read operations.
- The observer cannot emit forged operations (lacking the AES-GCM tags).
- The observer cannot profile network activity (thwarted by Cover Traffic).

The decision to abandon superficial room authentication ensures there are no architectural misunderstandings regarding where the security perimeter lies. The perimeter is not the socket room; the perimeter is the `documentKey`.

---

## 📋 Audit History

| Date | Phase | Notes |
|------|-------|-------|
| Q1 2026 | Phase 6 | Removed Room Auth implementation based on independent audit recommendation. Transitioned to "pure E2EE trustless model." Implemented timestamp-based deduplication pruning. |
| Q1 2026 | Phase 5 | Added exponential background cover traffic padding. Implemented WebSocket hard limits and CRDT GC tombstones for DoS mitigation. |
| Q1 2026 | Phase 4 | Implemented Lamport sequence strict verification. Overhauled initial peer consensus resolution via P2P web datachannels. |

---

## 🚨 Responsible Disclosure Policy
If you believe you have found a cryptographic flaw, a CRDT convergence breakage, or an implementation bug that leaks payload metadata, please contact: `security@ekya.io`
- **Response time target:** 72 hours.
- *At this time, we do not operate a formal bug bounty program.*

---

## 🔍 For Security Auditors

### Recommended Focus Areas (Priority Order)

**Critical Path Review:**
1. Cryptographic implementation (`src/crypto/`)
   - `TreeKEM.js` - Group key agreement logic
   - `DoubleRatchet.js` - Forward secrecy implementation
   - `KeyManager.js` - Key derivation and storage
   - `EncryptedEnvelope.js` - AES-GCM encryption

2. CRDT merge logic (`src/core/`)
   - `RGA.js` - Sequence CRDT convergence
   - `LWWMap.js` - Last-write-wins semantics
   - `RichText.js` - Formatting mark resolution
   - `VectorClock.js` - Causal ordering

3. Byzantine fault tolerance (`src/net/`)
   - `SyncProtocol.js` - Replay protection
   - `SnapshotManager.js` - Consensus verification
   - `AwarenessProtocol.js` - Presence handling

4. Application security
   - `EkyaDocument.js` - API boundary
   - Text rendering - XSS prevention (`escapeHTML`)
   - Memory management - DoS prevention (tombstone limits)

### Known Areas Requiring Extra Scrutiny

**Timing Side-Channels:**
- Web Crypto API is not strictly constant-time across all browser implementations.

**Snapshot Bootstrap:**
- First-peer scenario relies heavily on out-of-band `expectedGenesisHash` verification. Test attack profiles assuming a malicious relay attempts to serve poisoned initial snapshots before peer consensus is established.

**Cover Traffic:**
- Verify the exponential distribution truly defeats Hidden Markov Models under various `COVER_TRAFFIC_PROFILES`.

**CRDT Tombstone Limits:**
- Validate that the 100k tombstone limit accurately prevents memory exhaustion without inadvertently triggering premature deletion of valid nodes and compromising CRDT state convergence.
