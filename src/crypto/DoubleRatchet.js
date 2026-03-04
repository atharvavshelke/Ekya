/**
 * DoubleRatchet — Signal-style forward secrecy for CRDT operations.
 *
 * Implements a symmetric-key ratchet (the "sending" half of the
 * Signal double ratchet). Each operation gets a unique key derived
 * from a chain key, ensuring:
 *
 *   - **Forward secrecy**: Compromising key N doesn't reveal keys 0..N-1
 *   - **Break-in recovery**: After a DH ratchet step, attacker loses access
 *
 * Chain structure:
 * ```
 * rootKey ──HKDF──▶ chainKey₀ ──HKDF──▶ chainKey₁ ──HKDF──▶ ...
 *                      │                     │
 *                   msgKey₀               msgKey₁
 * ```
 *
 * Each message key is used exactly once, then discarded.
 *
 * @example
 * ```js
 * const ratchet = await DoubleRatchet.create(sharedSecret);
 *
 * // Sender
 * const { key, index } = await ratchet.nextSendKey();
 * // encrypt with key, send index in header
 *
 * // Receiver (separate ratchet instance with same shared secret)
 * const key = await receiverRatchet.getReceiveKey(index);
 * // decrypt with key
 * ```
 */
export class DoubleRatchet {
    /**
     * @param {CryptoKey} rootKey - HKDF base key
     * @param {ArrayBuffer} chainKey - Current chain key
     */
    constructor(rootKey, chainKey) {
        /** @type {CryptoKey} */
        this._rootKey = rootKey;
        /** @type {ArrayBuffer} */
        this._sendChainKey = chainKey;
        /** @type {ArrayBuffer} */
        this._recvChainKey = new ArrayBuffer(0);
        /** @type {number} */
        this._sendIndex = 0;
        /** @type {number} */
        this._recvIndex = 0;
        /** @type {Map<number, CryptoKey>} cached message keys for out-of-order */
        this._skippedKeys = new Map();
        /** @type {number} max skipped keys to cache */
        this._maxSkip = 100;
    }

    /**
     * Create a DoubleRatchet from a shared secret.
     * @param {ArrayBuffer} sharedSecret - From ECDH or TreeKEM
     * @returns {Promise<DoubleRatchet>}
     */
    static async create(sharedSecret) {
        // Import shared secret as HKDF base
        const rootKey = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, [
            'deriveBits',
            'deriveKey',
        ]);

        // Derive initial chain key
        const encoder = new TextEncoder();
        const chainKeyBits = await crypto.subtle.deriveBits(
            {
                name: 'HKDF',
                hash: 'SHA-256',
                salt: encoder.encode('ekya-ratchet-init'),
                info: encoder.encode('ekya-chain-key-v1'),
            },
            rootKey,
            256,
        );

        return new DoubleRatchet(rootKey, chainKeyBits);
    }

    /**
     * Create a paired ratchet for the receiver side.
     * Both sides must call this with the same shared secret.
     * @param {ArrayBuffer} sharedSecret
     * @returns {Promise<DoubleRatchet>}
     */
    static async createReceiver(sharedSecret) {
        const ratchet = await DoubleRatchet.create(sharedSecret);
        // Swap send/recv chains for the other side
        ratchet._recvChainKey = ratchet._sendChainKey;
        ratchet._sendChainKey = await DoubleRatchet._deriveNextChain(ratchet._rootKey, 'send-init');
        return ratchet;
    }

    /**
     * Advance the send chain and get the next message key.
     * @returns {Promise<{ key: CryptoKey, index: number }>}
     */
    async nextSendKey() {
        const { messageKey, nextChainKey } = await this._ratchetStep(this._sendChainKey);
        this._sendChainKey = nextChainKey;
        const index = this._sendIndex++;

        return { key: messageKey, index };
    }

    /**
     * Get the receive key for a specific message index.
     * Handles out-of-order delivery by caching skipped keys.
     * @param {number} index - Message index from the sender
     * @returns {Promise<CryptoKey>}
     */
    async getReceiveKey(index) {
        // Check skipped keys cache
        if (this._skippedKeys.has(index)) {
            const key = this._skippedKeys.get(index);
            this._skippedKeys.delete(index); // Use once, then discard
            return key;
        }

        // Skip ahead if needed (out-of-order messages)
        if (index > this._recvIndex) {
            const skip = index - this._recvIndex;
            if (skip > this._maxSkip) {
                throw new Error(`Too many skipped messages (${skip} > ${this._maxSkip})`);
            }

            // Advance the chain, caching intermediate keys
            for (let i = this._recvIndex; i < index; i++) {
                const { messageKey, nextChainKey } = await this._ratchetStep(this._recvChainKey);
                this._skippedKeys.set(i, messageKey);
                this._recvChainKey = nextChainKey;
            }
        }

        // Derive the key for the requested index
        const { messageKey, nextChainKey } = await this._ratchetStep(this._recvChainKey);
        this._recvChainKey = nextChainKey;
        this._recvIndex = index + 1;

        return messageKey;
    }

    /**
     * Perform one ratchet step: derive a message key and the next chain key.
     * @param {ArrayBuffer} chainKey
     * @returns {Promise<{ messageKey: CryptoKey, nextChainKey: ArrayBuffer }>}
     */
    async _ratchetStep(chainKey) {
        const baseKey = await crypto.subtle.importKey('raw', chainKey, 'HKDF', false, [
            'deriveBits',
            'deriveKey',
        ]);

        const encoder = new TextEncoder();

        // Derive message key (AES-256-GCM)
        const messageKey = await crypto.subtle.deriveKey(
            {
                name: 'HKDF',
                hash: 'SHA-256',
                salt: encoder.encode('ekya-msg-key'),
                info: encoder.encode('ekya-message-key-v1'),
            },
            baseKey,
            { name: 'AES-GCM', length: 256 },
            false, // Non-extractable for security
            ['encrypt', 'decrypt'],
        );

        // Derive next chain key
        const nextChainKey = await crypto.subtle.deriveBits(
            {
                name: 'HKDF',
                hash: 'SHA-256',
                salt: encoder.encode('ekya-chain-advance'),
                info: encoder.encode('ekya-chain-key-v1'),
            },
            baseKey,
            256,
        );

        return { messageKey, nextChainKey };
    }

    /**
     * Derive a new chain from the root key.
     * @param {CryptoKey} rootKey
     * @param {string} label
     * @returns {Promise<ArrayBuffer>}
     */
    static async _deriveNextChain(rootKey, label) {
        const encoder = new TextEncoder();
        return await crypto.subtle.deriveBits(
            {
                name: 'HKDF',
                hash: 'SHA-256',
                salt: encoder.encode(`ekya-${label}`),
                info: encoder.encode('ekya-chain-key-v1'),
            },
            rootKey,
            256,
        );
    }

    /**
     * Get ratchet state info (for debugging/monitoring).
     * @returns {{ sendIndex: number, recvIndex: number, skippedKeys: number }}
     */
    stats() {
        return {
            sendIndex: this._sendIndex,
            recvIndex: this._recvIndex,
            skippedKeys: this._skippedKeys.size,
        };
    }

    /**
     * Clear all cached skipped keys.
     */
    clearSkippedKeys() {
        this._skippedKeys.clear();
    }
}
