# Ekya Architecture Overview

## System Diagram

```
[Client] ←→ [E2EE Layer] ←→ [CRDT Layer] ←→ [Network Layer] ←→ [Trustless Relay]
    ↓           ↓               ↓                ↓                      ↓
  User      TreeKEM          RGA            WebSocket              Blind
   API      AES-GCM       LWWMap            WebRTC              Forwarding
          DoubleRatchet   VectorClock     SyncProtocol         (No Keys)
```

## Data Flow: Single Operation

1. User types character "h" in the editor.
2. `EkyaDocument.insert(5, "h")` creates a new `Operation`.
3. The underlying CRDT (e.g., `RGA`) applies the operation locally to update the user's view immediately.
4. The `Operation` is serialized using length-prefixed `MessagePack`.
5. The `DoubleRatchet` algorithm derives a unique, forward-secret encryption key for this specific operation.
6. The `AES-256-GCM` cipher encrypts the operation, authenticating the payload.
7. The ciphertext envelope is padded out to 512 bytes (or multiples thereof) to mask the operation type and content length.
8. The `SyncProtocol` batches the envelope and holds it, waiting for the exponential delay (averaging 500ms) to pass.
9. `WebSocketTransport` pushes the encrypted batch to the relay server.
10. The Relay Server blindly forwards the payload to all members connected to the room ID (it sees only the room ID, connection timing, and fixed-size ciphertexts).
11. Remote peers receive the payload and decrypt it via their synchronized `documentKey` and ratchet chain.
12. Each peer's local CRDT applies the decrypted operation.
13. **Convergence**: All peers reach the exact identical state deterministically.

## Security Boundaries

### 🛡️ Trust Boundary 1: User → Client
- The User is responsible for protecting their specific `documentKey` URL/string (this sits entirely outside Ekya's technical scope).
- The Client must render the CRDT outputs safely (e.g., `escapeHTML` for XSS prevention).

### 🛡️ Trust Boundary 2: Client → Network
- ALL operations are serialized, padded, and encrypted *before* they touch the network transmission array.
- "Cover Traffic" prevents active/idle activity patterns from leaking.
- WebRTC signaling (SDP/ICE profiles) is blinded by encrypting the handshake metadata, keeping the relay blind to peer IPs.

### 🛡️ Trust Boundary 3: Network → Relay
- The Relay Server is strictly considered **adversarial** and subject to Byzantine assumptions.
- The Relay sees only: encrypted padded blobs, room socket IDs, and connection frequencies.
- The Relay *cannot*: decrypt content, replay past operations (prevented by peer Lamport Clocks), or successfully poison snapshots (prevented by out-of-band verify logic and P2P gossip).

### 🛡️ Trust Boundary 4: Peer → Peer
- P2P Vector Clock gossip via WebRTC proactively verifies that the Relay is not serving strategically stale snapshots.
- `expectedGenesisHash` hard-verifications ensure that the *very first* snapshot served during an empty room bootstrap wasn't pre-poisoned by an attacker squatting the room.
- `UUID` deduplication caching strictly negates cross-session rebroadcasts.

## Key Innovation: Encryption-First CRDTs

### Traditional Distributed Collaboration
```
CRDT operations → Network → Server merges → Broadcast
(The Server MUST see plaintext operations to arrange them)
```

### Ekya Approach (Dissident-Grade)
```
CRDT operations → Encrypt individually → Network → Relay forwards blindly → Peers decrypt and merge
(The Server sees ONLY ciphertext)
```

This model is mathematically possible because the CRDT merge resolution is inherently:
- **Commutative**: The order in which operations arrive no longer breaks the state.
- **Idempotent**: Applying the exact same operation twice has the same result as applying it once.
- **Deterministic**: The exact same inputs rigorously guarantee the exact same output.

By exploiting these properties, Ekya encrypts operations *before* merging without sacrificing multi-user convergence guarantees.
