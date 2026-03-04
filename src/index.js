/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║                                                               ║
 * ║   ██████╗ ██╗  ██╗██╗   ██╗ █████╗                           ║
 * ║   ██╔═══╝ ██║ ██╔╝╚██╗ ██╔╝██╔══██╗                         ║
 * ║   █████╗  █████╔╝  ╚████╔╝ ███████║                          ║
 * ║   ██╔══╝  ██╔═██╗   ╚██╔╝  ██╔══██║                          ║
 * ║   ██████╗ ██║  ██╗   ██║   ██║  ██║                          ║
 * ║   ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝                        ║
 * ║                                                               ║
 * ║   E2EE Real-Time Collaborative CRDT Framework                ║
 * ║   The server never sees your data.                            ║
 * ║                                                               ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * @module ekya
 */

// ─── Developer API ───────────────────────────────────────────────
export { EkyaDocument } from './EkyaDocument.js';
export { EkyaProvider } from './EkyaProvider.js';

// ─── CRDTs (for custom/advanced usage) ──────────────────────────
export { GCounter } from './core/GCounter.js';
export { PNCounter } from './core/PNCounter.js';
export { LWWRegister } from './core/LWWRegister.js';
export { LWWMap } from './core/LWWMap.js';
export { RGA } from './core/RGA.js';
export { RichText } from './core/RichText.js';
export { VectorClock } from './core/VectorClock.js';
export { Operation } from './core/Operation.js';
export { Serializer } from './core/Serializer.js';

// ─── Crypto ──────────────────────────────────────────────────────
export { KeyManager } from './crypto/KeyManager.js';
export { EncryptedEnvelope } from './crypto/EncryptedEnvelope.js';
export { KeyRotation } from './crypto/KeyRotation.js';
export { TreeKEM } from './crypto/TreeKEM.js';
export { DoubleRatchet } from './crypto/DoubleRatchet.js';

// ─── Networking ──────────────────────────────────────────────────
export { WebSocketTransport } from './net/WebSocketTransport.js';
export { WebRTCTransport } from './net/WebRTCTransport.js';
export { HybridTransport } from './net/HybridTransport.js';
export { SyncProtocol } from './net/SyncProtocol.js';
export { AwarenessProtocol } from './net/AwarenessProtocol.js';
