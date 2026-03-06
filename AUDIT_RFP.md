# Ekya Security Audit - Request for Proposal

## Project Overview
Ekya is an open-source E2EE collaborative CRDT framework combining:
- Signal Protocol-level group encryption (TreeKEM + Double Ratchet)
- Conflict-free collaborative editing (custom CRDTs)
- Traffic analysis resistance (cover traffic + exponential batching)
- "Dissident-Grade" metadata privacy profiles

## Audit Scope
**In-Scope:**
- Cryptographic implementation (`TreeKEM`, `Double Ratchet`, `AES-GCM`)
- CRDT convergence correctness (`RGA`, `LWWMap`, `RichText`, `GCounter`, `PNCounter`)
- Byzantine fault tolerance (Lamport replay protection, P2P snapshot consensus)
- Traffic analysis resistance (cover traffic padding & batching algorithms)
- Application security (DOM XSS prevention, Tombstone DoS mitigation)

**Out-of-Scope:**
- Network infrastructure security (BGP hijacking, etc.)
- Network-layer anonymity (Tor / VPN layers)
- Client device security (OS malware, memory extraction)
- Social engineering attacks (Phishing the documentKey URL)
- Quantum cryptanalysis (Currently relying on ECDH P-256)

## Codebase Statistics
- **Lines of Code**: ~14,000
- **Languages**: JavaScript (Node.js + Browser DOM)
- **Test Coverage**: 144 passing tests (100% convergence rate under stress)
- **Key Components**: 25 core files (CRDT + Crypto + Network)
- **Dependencies**: `msgpackr`, `uuid`, `ws`. All cryptography utilizes zero-dependency native WebCrypto APIs.

## Deliverables Requested
1. Comprehensive security assessment report
2. Threat model validation against the established `SECURITY.md`
3. Code review findings (Architectural vulnerabilities, cryptographic implementation critiques)
4. CRDT correctness verification under Byzantine conditions
5. Public disclosure of findings (after a negotiated remediation window)

## Timeline
**Preferred**: 6-8 weeks from engagement start
**Flexible**: Can accommodate firm's schedule

## Budget Range
[To be discussed based on firm's pricing & availability]

## Contact
Please direct inquiries, quotes, and PGP fingerprints to: `security@ekya.io`
