import { EventEmitter } from 'events';
import { GCounter } from './core/GCounter.js';
import { LWWRegister } from './core/LWWRegister.js';
import { LWWMap } from './core/LWWMap.js';
import { RGA } from './core/RGA.js';

/**
 * EkyaDocument — The main developer-facing class.
 *
 * Wraps a CRDT instance and provides a clean API for collaborative editing.
 * Operations produced by mutations are emitted as 'operation' events,
 * which the EkyaProvider encrypts and broadcasts.
 *
 * @example
 * ```js
 * // Collaborative text editor
 * const doc = new EkyaDocument({ id: 'doc-1', type: 'text', nodeId: 'alice' });
 * doc.insertText(0, 'Hello');
 * doc.on('update', () => console.log(doc.getText()));
 *
 * // Shared counter
 * const counter = new EkyaDocument({ id: 'votes', type: 'counter', nodeId: 'bob' });
 * counter.increment(1);
 * console.log(counter.value());
 *
 * // Key-value store
 * const config = new EkyaDocument({ id: 'config', type: 'map', nodeId: 'carol' });
 * config.set('theme', 'dark');
 * console.log(config.get('theme'));
 * ```
 */
export class EkyaDocument extends EventEmitter {
    /**
     * @param {object} params
     * @param {string} params.id - Unique document identifier
     * @param {'text'|'counter'|'map'|'register'} params.type - CRDT type
     * @param {string} params.nodeId - Local node/user identifier
     */
    constructor({ id, type, nodeId }) {
        super();
        this.id = id;
        this.type = type;
        this.nodeId = nodeId;

        /** @type {GCounter|LWWRegister|LWWMap|RGA} */
        this._crdt = this._createCRDT(type, id, nodeId);
    }

    /**
     * Create the appropriate CRDT instance.
     * @param {string} type
     * @param {string} id
     * @param {string} nodeId
     * @returns {GCounter|LWWRegister|LWWMap|RGA}
     */
    _createCRDT(type, id, nodeId) {
        switch (type) {
            case 'counter':
                return new GCounter(id, nodeId);
            case 'register':
                return new LWWRegister(id, nodeId);
            case 'map':
                return new LWWMap(id, nodeId);
            case 'text':
                return new RGA(id, nodeId);
            default:
                throw new Error(`Unknown CRDT type: ${type}`);
        }
    }

    // ─── Counter API ───────────────────────────────────────────────

    /**
     * Increment the counter (type: 'counter' only).
     * @param {number} [amount=1]
     * @returns {import('./core/Operation.js').Operation}
     */
    increment(amount = 1) {
        this._assertType('counter');
        const op = this._crdt.increment(amount);
        this.emit('operation', op);
        this.emit('update', { type: 'increment', amount });
        return op;
    }

    /**
     * Get counter value (type: 'counter' only).
     * @returns {number}
     */
    value() {
        this._assertType('counter');
        return this._crdt.value();
    }

    // ─── Register API ──────────────────────────────────────────────

    /**
     * Set the register value (type: 'register' only).
     * @param {*} value
     * @returns {import('./core/Operation.js').Operation}
     */
    setValue(value) {
        this._assertType('register');
        const op = this._crdt.set(value);
        this.emit('operation', op);
        this.emit('update', { type: 'set', value });
        return op;
    }

    /**
     * Get register value (type: 'register' only).
     * @returns {*}
     */
    getValue() {
        this._assertType('register');
        return this._crdt.get();
    }

    // ─── Map API ───────────────────────────────────────────────────

    /**
     * Set a key-value pair (type: 'map' only).
     * @param {string} key
     * @param {*} value
     * @returns {import('./core/Operation.js').Operation}
     */
    set(key, value) {
        this._assertType('map');
        const op = this._crdt.set(key, value);
        this.emit('operation', op);
        this.emit('update', { type: 'set', key, value });
        return op;
    }

    /**
     * Get a value by key (type: 'map' only).
     * @param {string} key
     * @returns {*}
     */
    get(key) {
        this._assertType('map');
        return this._crdt.get(key);
    }

    /**
     * Delete a key (type: 'map' only).
     * @param {string} key
     * @returns {import('./core/Operation.js').Operation}
     */
    deleteKey(key) {
        this._assertType('map');
        const op = this._crdt.delete(key);
        this.emit('operation', op);
        this.emit('update', { type: 'delete', key });
        return op;
    }

    /**
     * Check if a key exists (type: 'map' only).
     * @param {string} key
     * @returns {boolean}
     */
    has(key) {
        this._assertType('map');
        return this._crdt.has(key);
    }

    /**
     * Get all keys (type: 'map' only).
     * @returns {string[]}
     */
    keys() {
        this._assertType('map');
        return this._crdt.keys();
    }

    /**
     * Get map as a plain object (type: 'map' only).
     * @returns {Record<string, *>}
     */
    toObject() {
        this._assertType('map');
        return this._crdt.toObject();
    }

    // ─── Text API ──────────────────────────────────────────────────

    /**
     * Insert text at a position (type: 'text' only).
     * @param {number} index - Visible character index
     * @param {string} text - Text to insert (each char becomes a separate op)
     * @returns {import('./core/Operation.js').Operation[]}
     */
    insertText(index, text) {
        this._assertType('text');
        const ops = [];
        for (let i = 0; i < text.length; i++) {
            const op = this._crdt.insert(index + i, text[i]);
            ops.push(op);
            this.emit('operation', op);
        }
        this.emit('update', { type: 'insert', index, text });
        return ops;
    }

    /**
     * Delete text at a position (type: 'text' only).
     * @param {number} index - Visible character start index
     * @param {number} [count=1] - Number of characters to delete
     * @returns {import('./core/Operation.js').Operation[]}
     */
    deleteText(index, count = 1) {
        this._assertType('text');
        const ops = [];
        // Delete from the end to avoid index shifting
        for (let i = 0; i < count; i++) {
            const op = this._crdt.delete(index);
            ops.push(op);
            this.emit('operation', op);
        }
        this.emit('update', { type: 'delete', index, count });
        return ops;
    }

    /**
     * Get the full text (type: 'text' only).
     * @returns {string}
     */
    getText() {
        this._assertType('text');
        return this._crdt.toString();
    }

    /**
     * Get text length (type: 'text' only).
     * @returns {number}
     */
    get textLength() {
        this._assertType('text');
        return this._crdt.length;
    }

    // ─── Shared API ────────────────────────────────────────────────

    /**
     * Apply a remote operation to the underlying CRDT.
     * @param {import('./core/Operation.js').Operation} operation
     * @returns {boolean} true if applied (not duplicate)
     */
    applyRemoteOperation(operation) {
        const applied = this._crdt.apply(operation);
        if (applied) {
            this.emit('update', { type: 'remote', operation });
        }
        return applied;
    }

    /**
     * Load state from a snapshot.
     * @param {object} state - CRDT state from toJSON()
     */
    loadSnapshot(state) {
        switch (this.type) {
            case 'counter':
                this._crdt = GCounter.fromJSON(state);
                break;
            case 'register':
                this._crdt = LWWRegister.fromJSON(state);
                break;
            case 'map':
                this._crdt = LWWMap.fromJSON(state);
                break;
            case 'text':
                this._crdt = RGA.fromJSON(state);
                break;
        }
        this.emit('update', { type: 'snapshot' });
    }

    /**
     * Get the current CRDT state (for snapshot creation).
     * @returns {object}
     */
    getSnapshot() {
        return this._crdt.toJSON();
    }

    /**
     * Assert the document is of a specific type.
     * @param {string} expectedType
     */
    _assertType(expectedType) {
        if (this.type !== expectedType) {
            throw new Error(`Operation not supported on '${this.type}' document (expected '${expectedType}')`);
        }
    }
}
