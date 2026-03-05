/**
 * Ekya Browser Bundle — Self-contained CRDT + Crypto for the demo.
 *
 * Since the main SDK uses Node.js crypto.subtle and ES modules,
 * this file provides a browser-compatible version using the
 * native Web Crypto API (window.crypto.subtle).
 */

// ─── VectorClock ────────────────────────────────────────────
class VectorClock {
    constructor(clocks = {}) {
        this.clocks = { ...clocks };
    }
    increment(nodeId) {
        this.clocks[nodeId] = (this.clocks[nodeId] || 0) + 1;
        return this;
    }
    get(nodeId) { return this.clocks[nodeId] || 0; }
    merge(other) {
        const otherClocks = other instanceof VectorClock ? other.clocks : other;
        for (const [id, val] of Object.entries(otherClocks)) {
            this.clocks[id] = Math.max(this.clocks[id] || 0, val);
        }
        return this;
    }
    toJSON() { return { ...this.clocks }; }
    static fromJSON(data) { return new VectorClock(data); }
}

// ─── Operation ──────────────────────────────────────────────
class Operation {
    constructor({ type, crdtId, nodeId, clock, causalDeps, data, opId }) {
        this.type = type;
        this.crdtId = crdtId;
        this.nodeId = nodeId;
        this.clock = clock;
        this.causalDeps = causalDeps;
        this.data = data;
        this.opId = opId || Operation.computeId({ type, crdtId, nodeId, clock, data });
    }
    static async computeIdAsync({ type, crdtId, nodeId, clock, data }) {
        const payload = `${nodeId}:${clock}:${type}:${crdtId}:${JSON.stringify(data)}`;
        const buf = new TextEncoder().encode(payload);
        const hash = await crypto.subtle.digest('SHA-256', buf);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    static computeId({ type, crdtId, nodeId, clock, data }) {
        // Sync fallback: use a simple hash
        const payload = `${nodeId}:${clock}:${type}:${crdtId}:${JSON.stringify(data)}`;
        let hash = 0;
        for (let i = 0; i < payload.length; i++) {
            const chr = payload.charCodeAt(i);
            hash = ((hash << 5) - hash) + chr;
            hash |= 0;
        }
        return 'op_' + Math.abs(hash).toString(36) + '_' + Date.now().toString(36);
    }
    toJSON() {
        return {
            opId: this.opId, type: this.type, crdtId: this.crdtId,
            nodeId: this.nodeId, clock: this.clock, causalDeps: this.causalDeps, data: this.data
        };
    }
    static fromJSON(json) { return new Operation(json); }
}

// ─── GCounter ───────────────────────────────────────────────
class GCounter {
    constructor(id, nodeId) {
        this.id = id;
        this.nodeId = nodeId;
        this.counts = {};
        this.clock = new VectorClock();
        this._appliedOps = new Set();
    }
    increment(amount = 1) {
        this.counts[this.nodeId] = (this.counts[this.nodeId] || 0) + amount;
        this.clock.increment(this.nodeId);
        const op = new Operation({
            type: 'gcounter:increment', crdtId: this.id, nodeId: this.nodeId,
            clock: this.clock.get(this.nodeId), causalDeps: this.clock.toJSON(),
            data: { amount },
        });
        this._appliedOps.add(op.opId);
        return op;
    }
    apply(op) {
        if (this._appliedOps.has(op.opId)) return false;
        this.counts[op.nodeId] = (this.counts[op.nodeId] || 0) + op.data.amount;
        this.clock.merge(op.causalDeps);
        this._appliedOps.add(op.opId);
        return true;
    }
    value() { return Object.values(this.counts).reduce((s, n) => s + n, 0); }
    toJSON() { return { id: this.id, nodeId: this.nodeId, counts: { ...this.counts }, clock: this.clock.toJSON() }; }
    static fromJSON(data) {
        const c = new GCounter(data.id, data.nodeId);
        c.counts = { ...data.counts };
        c.clock = VectorClock.fromJSON(data.clock);
        return c;
    }
}

// ─── RGA ────────────────────────────────────────────────────
class RGA {
    constructor(id, nodeId) {
        this.id = id;
        this.nodeId = nodeId;
        this._seq = 0;
        this._elements = [];
        this.clock = new VectorClock();
        this._appliedOps = new Set();
    }
    _nextElemId() {
        this._seq++;
        return { nodeId: this.nodeId, seq: this._seq };
    }
    static compareElemIds(a, b) {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
        if (a.nodeId !== b.nodeId) return a.nodeId < b.nodeId ? -1 : 1;
        return a.seq - b.seq;
    }
    static elemIdEquals(a, b) {
        if (a === null && b === null) return true;
        if (a === null || b === null) return false;
        return a.nodeId === b.nodeId && a.seq === b.seq;
    }
    _findIndex(elemId) {
        if (!elemId) return -1;
        return this._elements.findIndex(e => RGA.elemIdEquals(e.elemId, elemId));
    }
    insert(visibleIndex, value) {
        this.clock.increment(this.nodeId);
        const timestamp = Date.now();
        const elemId = this._nextElemId();
        const afterId = this._visibleIndexToAfterId(visibleIndex);
        const pos = this._findInsertPosition(afterId, elemId, timestamp);
        this._elements.splice(pos, 0, { elemId, value, deleted: false, timestamp, afterId });
        const op = new Operation({
            type: 'rga:insert', crdtId: this.id, nodeId: this.nodeId,
            clock: this.clock.get(this.nodeId), causalDeps: this.clock.toJSON(),
            data: { elemId, value, afterId, timestamp },
        });
        this._appliedOps.add(op.opId);
        return op;
    }
    delete(visibleIndex) {
        this.clock.increment(this.nodeId);
        let count = 0;
        let target = null;
        for (const elem of this._elements) {
            if (!elem.deleted) {
                if (count === visibleIndex) { target = elem; break; }
                count++;
            }
        }
        if (!target) throw new Error('Delete out of bounds');
        target.deleted = true;
        const op = new Operation({
            type: 'rga:delete', crdtId: this.id, nodeId: this.nodeId,
            clock: this.clock.get(this.nodeId), causalDeps: this.clock.toJSON(),
            data: { elemId: target.elemId },
        });
        this._appliedOps.add(op.opId);
        return op;
    }
    _visibleIndexToAfterId(idx) {
        if (idx === 0) return null;
        let count = 0;
        for (const elem of this._elements) {
            if (!elem.deleted) {
                count++;
                if (count === idx) return elem.elemId;
            }
        }
        for (let i = this._elements.length - 1; i >= 0; i--) {
            if (!this._elements[i].deleted) return this._elements[i].elemId;
        }
        return null;
    }
    _findInsertPosition(afterId, newElemId, timestamp) {
        let startPos = afterId === null ? 0 : (() => {
            const idx = this._findIndex(afterId);
            return idx === -1 ? this._elements.length : idx + 1;
        })();
        const newItem = { ...newElemId, timestamp };
        let pos = startPos;
        while (pos < this._elements.length) {
            const existing = this._elements[pos];
            if (!RGA.elemIdEquals(existing.afterId, afterId)) break;
            const cmp = RGA.compareElemIds(
                { ...existing.elemId, timestamp: existing.timestamp }, newItem
            );
            if (cmp <= 0) break;
            pos++;
        }
        return pos;
    }
    apply(op) {
        if (this._appliedOps.has(op.opId)) return false;
        this._appliedOps.add(op.opId);
        this.clock.merge(op.causalDeps);
        if (op.type === 'rga:insert') {
            const { elemId, value, afterId, timestamp } = op.data;
            if (this._findIndex(elemId) !== -1) return false;
            if (elemId.nodeId === this.nodeId) this._seq = Math.max(this._seq, elemId.seq);
            const pos = this._findInsertPosition(afterId, elemId, timestamp);
            this._elements.splice(pos, 0, { elemId, value, deleted: false, timestamp, afterId });
            return true;
        } else if (op.type === 'rga:delete') {
            const idx = this._findIndex(op.data.elemId);
            if (idx === -1) return false;
            this._elements[idx].deleted = true;
            return true;
        }
        return false;
    }
    toString() { return this._elements.filter(e => !e.deleted).map(e => e.value).join(''); }
    get length() { return this._elements.filter(e => !e.deleted).length; }
    toJSON() {
        return {
            id: this.id, nodeId: this.nodeId, seq: this._seq,
            elements: this._elements.map(e => ({ ...e })), clock: this.clock.toJSON()
        };
    }
    static fromJSON(data) {
        const rga = new RGA(data.id, data.nodeId);
        rga._seq = data.seq;
        rga._elements = data.elements.map(e => ({ ...e }));
        rga.clock = VectorClock.fromJSON(data.clock);
        return rga;
    }
}

// ─── Browser Crypto (Web Crypto API) ────────────────────────
class BrowserCrypto {
    static async generateDocumentKey() {
        return await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
        );
    }
    static async encrypt(data, key) {
        const iv = crypto.getRandomValues(new Uint8Array(12));

        // Tier 1 Metadata fix: Fixed-size envelope padding
        let jsonPayload = JSON.stringify(data);
        const CHUNK_SIZE = 512;
        const padLength = CHUNK_SIZE - (jsonPayload.length % CHUNK_SIZE);
        if (padLength > 0) {
            jsonPayload = jsonPayload.padEnd(jsonPayload.length + padLength, ' ');
        }
        const plaintext = new TextEncoder().encode(jsonPayload);

        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
        return {
            iv: btoa(String.fromCharCode(...iv)),
            ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
            timestamp: Date.now(),
        };
    }
    static async decrypt(envelope, key) {
        const iv = Uint8Array.from(atob(envelope.iv), c => c.charCodeAt(0));
        const ciphertext = Uint8Array.from(atob(envelope.ciphertext), c => c.charCodeAt(0));
        const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
        return JSON.parse(new TextDecoder().decode(plaintext));
    }
    static async exportKeyToBase64(key) {
        const raw = await crypto.subtle.exportKey('raw', key);
        return btoa(String.fromCharCode(...new Uint8Array(raw)));
    }
    static async generateRoomAuthToken(roomId, key) {
        const raw = await crypto.subtle.exportKey('raw', key);
        const roomIdBuf = new TextEncoder().encode(roomId);
        const combined = new Uint8Array(raw.byteLength + roomIdBuf.byteLength);
        combined.set(new Uint8Array(raw), 0);
        combined.set(roomIdBuf, raw.byteLength);
        const hash = await crypto.subtle.digest('SHA-256', combined);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
}

// ─── Export to window ───────────────────────────────────────
window.Ekya = {
    VectorClock,
    Operation,
    GCounter,
    RGA,
    BrowserCrypto,
};
