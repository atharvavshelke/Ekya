import { KeyManager } from './KeyManager.js';

/**
 * TreeKEM — MLS-style Group Key Agreement Protocol.
 *
 * Implements a simplified Messaging Layer Security (MLS) tree-based
 * key agreement for N-party groups. Each member holds a leaf node
 * in a binary tree; path secrets are derived upward to the root,
 * giving all members the same group secret without any pairwise explosion.
 *
 * Key properties:
 *   - O(log N) key material per update (not O(N²) like pairwise ECDH)
 *   - Forward secrecy on member removal (new tree secret)
 *   - Post-compromise security on key update (path refresh)
 *
 * Simplified from RFC 9420 (MLS) for practical use.
 *
 * @example
 * ```js
 * const group = new TreeKEM('room-42');
 * const leafIndex = await group.addMember('alice');
 * await group.addMember('bob');
 * await group.addMember('carol');
 *
 * const groupKey = await group.getGroupKey();
 * // All members derive the same AES-256-GCM key
 * ```
 */
export class TreeKEM {
    /**
     * @param {string} groupId - Unique group/room identifier
     */
    constructor(groupId) {
        this.groupId = groupId;
        /** @type {Array<{memberId: string, leafSecret: ArrayBuffer}|null>} */
        this._leaves = [];
        /** @type {Map<number, ArrayBuffer>} nodeIndex → secret */
        this._tree = new Map();
        /** @type {number} */
        this._epoch = 0;
        /** @type {Map<string, number>} memberId → leafIndex */
        this._memberIndex = new Map();
    }

    /**
     * Add a member to the group.
     * @param {string} memberId
     * @returns {Promise<number>} Leaf index
     */
    async addMember(memberId) {
        if (this._memberIndex.has(memberId)) {
            return this._memberIndex.get(memberId);
        }

        // Generate a random leaf secret for the new member
        const leafSecret = crypto.getRandomValues(new Uint8Array(32)).buffer;

        // Find the first empty slot or append
        let leafIndex = this._leaves.findIndex((l) => l === null);
        if (leafIndex === -1) {
            leafIndex = this._leaves.length;
            this._leaves.push(null);
        }

        this._leaves[leafIndex] = { memberId, leafSecret };
        this._memberIndex.set(memberId, leafIndex);

        // Update path secrets from this leaf to root
        await this._updatePath(leafIndex);
        this._epoch++;

        return leafIndex;
    }

    /**
     * Remove a member from the group.
     * Generates new path secrets (forward secrecy — removed member
     * cannot derive future group keys).
     * @param {string} memberId
     * @returns {Promise<boolean>}
     */
    async removeMember(memberId) {
        const leafIndex = this._memberIndex.get(memberId);
        if (leafIndex === undefined) return false;

        // Blank the leaf
        this._leaves[leafIndex] = null;
        this._memberIndex.delete(memberId);

        // Clear the path from this leaf to root
        this._clearPath(leafIndex);

        // If there are remaining members, refresh from the first active leaf
        const activeLeaf = this._leaves.findIndex((l) => l !== null);
        if (activeLeaf !== -1) {
            // Generate fresh secret for path refresh
            this._leaves[activeLeaf].leafSecret = crypto.getRandomValues(new Uint8Array(32)).buffer;
            await this._updatePath(activeLeaf);
        }

        this._epoch++;
        return true;
    }

    /**
     * Update a member's key material (post-compromise security).
     * @param {string} memberId
     * @returns {Promise<void>}
     */
    async updateMemberKey(memberId) {
        const leafIndex = this._memberIndex.get(memberId);
        if (leafIndex === undefined) throw new Error(`Member not found: ${memberId}`);

        // Fresh leaf secret
        this._leaves[leafIndex].leafSecret = crypto.getRandomValues(new Uint8Array(32)).buffer;
        await this._updatePath(leafIndex);
        this._epoch++;
    }

    /**
     * Derive the group key (root secret → AES-256-GCM key).
     * @returns {Promise<CryptoKey>}
     */
    async getGroupKey() {
        const rootSecret = this._getRootSecret();
        if (!rootSecret) {
            throw new Error('No members in group — cannot derive key');
        }

        // Import root secret as HKDF base
        const baseKey = await crypto.subtle.importKey('raw', rootSecret, 'HKDF', false, [
            'deriveKey',
        ]);

        const encoder = new TextEncoder();
        return await crypto.subtle.deriveKey(
            {
                name: 'HKDF',
                hash: 'SHA-256',
                salt: encoder.encode(`ekya-group-${this.groupId}-epoch-${this._epoch}`),
                info: encoder.encode('ekya-group-key-v1'),
            },
            baseKey,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt'],
        );
    }

    /**
     * Get the current epoch.
     * @returns {number}
     */
    get epoch() {
        return this._epoch;
    }

    /**
     * Get all active member IDs.
     * @returns {string[]}
     */
    get members() {
        return this._leaves.filter((l) => l !== null).map((l) => l.memberId);
    }

    /**
     * Get the number of active members.
     * @returns {number}
     */
    get size() {
        return this._memberIndex.size;
    }

    // ─── Internal Tree Operations ───────────────────────────────

    /**
     * Update path secrets from a leaf to the root.
     * @param {number} leafIndex
     */
    async _updatePath(leafIndex) {
        const leaf = this._leaves[leafIndex];
        if (!leaf) return;

        // Set the leaf node secret
        const nodeIndex = this._leafToNode(leafIndex);
        this._tree.set(nodeIndex, leaf.leafSecret);

        // Walk up the tree, combining sibling secrets
        let current = nodeIndex;
        while (current > 0) {
            const parent = this._parent(current);
            const sibling = this._sibling(current);

            const currentSecret = this._tree.get(current);
            const siblingSecret = this._tree.get(sibling);

            if (currentSecret && siblingSecret) {
                // Combine using HKDF
                const combined = await this._combineSecrets(currentSecret, siblingSecret);
                this._tree.set(parent, combined);
            } else if (currentSecret) {
                // Only one child has a secret — propagate it up
                this._tree.set(parent, currentSecret);
            }

            current = parent;
        }
    }

    /**
     * Clear path secrets from a leaf to the root.
     * @param {number} leafIndex
     */
    _clearPath(leafIndex) {
        let current = this._leafToNode(leafIndex);
        while (current >= 0) {
            this._tree.delete(current);
            if (current === 0) break;
            current = this._parent(current);
        }
    }

    /**
     * Get the root secret (node 0).
     * @returns {ArrayBuffer|undefined}
     */
    _getRootSecret() {
        // If only one member, the root IS the leaf
        if (this._tree.has(0)) return this._tree.get(0);

        // Walk the tree to find the effective root
        for (let i = 0; i <= this._maxNodeIndex(); i++) {
            if (this._tree.has(i) && i === 0) return this._tree.get(i);
        }

        // Fallback: first available secret
        const firstLeaf = this._leaves.find((l) => l !== null);
        return firstLeaf ? firstLeaf.leafSecret : undefined;
    }

    /**
     * Combine two secrets using HKDF.
     * @param {ArrayBuffer} a
     * @param {ArrayBuffer} b
     * @returns {Promise<ArrayBuffer>}
     */
    async _combineSecrets(a, b) {
        // Concatenate the two secrets
        const combined = new Uint8Array(a.byteLength + b.byteLength);
        combined.set(new Uint8Array(a), 0);
        combined.set(new Uint8Array(b), a.byteLength);

        // Hash to produce a new secret
        return await crypto.subtle.digest('SHA-256', combined);
    }

    // ─── Binary Tree Indexing ───────────────────────────────────
    // Uses implicit binary tree layout where:
    //   - Node 0 is the root
    //   - Left child of node i = 2i + 1
    //   - Right child of node i = 2i + 2
    //   - Parent of node i = floor((i - 1) / 2)
    //   - Leaves start at depth = ceil(log2(numLeaves))

    _leafToNode(leafIndex) {
        const depth = this._treeDepth();
        return (1 << depth) - 1 + leafIndex;
    }

    _treeDepth() {
        const numLeaves = Math.max(this._leaves.length, 1);
        return Math.ceil(Math.log2(numLeaves + 1));
    }

    _parent(nodeIndex) {
        return Math.floor((nodeIndex - 1) / 2);
    }

    _sibling(nodeIndex) {
        if (nodeIndex === 0) return 0;
        return nodeIndex % 2 === 0 ? nodeIndex - 1 : nodeIndex + 1;
    }

    _maxNodeIndex() {
        const depth = this._treeDepth();
        return (1 << (depth + 1)) - 2;
    }

    /**
     * Serialize the tree state (for snapshot).
     * @returns {object}
     */
    toJSON() {
        return {
            groupId: this.groupId,
            epoch: this._epoch,
            members: this.members,
            size: this.size,
        };
    }
}
