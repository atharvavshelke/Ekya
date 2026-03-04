import { KeyManager } from './KeyManager.js';

/**
 * KeyRotation — Epoch-based key rotation for document keys.
 *
 * Each key rotation increments the epoch. Historical keys are retained
 * so that operations encrypted under older epochs can still be decrypted.
 *
 * On rotation:
 *   1. New document key generated
 *   2. Epoch incremented
 *   3. Triggers snapshot creation (so late joiners only need the latest key)
 *   4. Old key retained in the key chain for decrypting in-flight messages
 *
 * Boss Fight #2 addressed:
 *   - Late joiners receive the current document key (encrypted with ECDH)
 *   - They receive an encrypted snapshot at the current epoch
 *   - They do NOT need historical keys (snapshot is the starting point)
 */
export class KeyRotation {
    /**
     * @param {CryptoKey} [initialKey] - Initial document key
     */
    constructor(initialKey) {
        this._epoch = 0;
        /** @type {Map<number, CryptoKey>} */
        this._keyChain = new Map();
        if (initialKey) {
            this._keyChain.set(0, initialKey);
        }
        /** @type {Function[]} */
        this._rotationListeners = [];
    }

    /**
     * Get the current epoch.
     * @returns {number}
     */
    get epoch() {
        return this._epoch;
    }

    /**
     * Get the current document key.
     * @returns {CryptoKey|undefined}
     */
    get currentKey() {
        return this._keyChain.get(this._epoch);
    }

    /**
     * Set the initial key (used when joining a document).
     * @param {CryptoKey} key
     * @param {number} [epoch=0]
     */
    setKey(key, epoch = 0) {
        this._epoch = epoch;
        this._keyChain.set(epoch, key);
    }

    /**
     * Rotate to a new document key.
     * @returns {Promise<{key: CryptoKey, epoch: number}>}
     */
    async rotateKey() {
        const newKey = await KeyManager.generateDocumentKey();
        this._epoch++;
        this._keyChain.set(this._epoch, newKey);

        // Notify listeners (triggers snapshot creation)
        for (const listener of this._rotationListeners) {
            await listener(newKey, this._epoch);
        }

        return { key: newKey, epoch: this._epoch };
    }

    /**
     * Get the key for a specific epoch (for decrypting older messages).
     * @param {number} epoch
     * @returns {CryptoKey|undefined}
     */
    getKeyForEpoch(epoch) {
        return this._keyChain.get(epoch);
    }

    /**
     * Register a listener for key rotation events.
     * @param {(key: CryptoKey, epoch: number) => Promise<void>} callback
     */
    onRotation(callback) {
        this._rotationListeners.push(callback);
    }

    /**
     * Prune old keys below a certain epoch (for memory management).
     * Only call this after confirming no pending operations from old epochs.
     * @param {number} keepAboveEpoch - Keep keys for epochs > this value
     */
    pruneKeys(keepAboveEpoch) {
        for (const [epoch] of this._keyChain) {
            if (epoch < keepAboveEpoch) {
                this._keyChain.delete(epoch);
            }
        }
    }

    /**
     * Get the number of keys in the chain.
     * @returns {number}
     */
    get keyCount() {
        return this._keyChain.size;
    }
}
