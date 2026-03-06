import { VectorClock } from './VectorClock.js';
import { Operation } from './Operation.js';
import { RGA } from './RGA.js';

/**
 * RichText — Block-based Rich Text CRDT.
 *
 * Extends character-level RGA with formatting marks (bold, italic, etc.)
 * and block structure (paragraphs, headings, lists).
 *
 * Architecture:
 *   - Text content: RGA (character-level, conflict-free)
 *   - Formatting: LWW annotations on character ranges
 *   - Blocks: Ordered list of block descriptors with LWW type resolution
 *
 * Formatting model:
 *   Each character has a set of marks (bold, italic, code, etc.).
 *   Marks are applied via ranges, stored as formatting operations.
 *   Concurrent format + unformat resolves via LWW (latest timestamp wins).
 *
 * Block model:
 *   The text is divided into blocks separated by newline characters.
 *   Each block has a type (paragraph, heading, list item, etc.)
 *   and optional metadata. Block types use LWW for conflict resolution.
 *
 * @example
 * ```js
 * const doc = new RichText('doc-1', 'alice');
 * doc.insertText(0, 'Hello World');
 * doc.applyFormat(0, 5, 'bold', true);     // Bold "Hello"
 * doc.applyFormat(6, 11, 'italic', true);  // Italic "World"
 * doc.setBlockType(0, 'heading', { level: 1 });
 *
 * console.log(doc.toHTML());
 * // <h1><b>Hello</b> <i>World</i></h1>
 * ```
 */
export class RichText {
    // Tier 1 Metadata fix: Priority and Nestability for marks
    static MARK_TYPES = {
        bold: { nestable: true, priority: 1, exclusive: false },
        italic: { nestable: true, priority: 1, exclusive: false },
        underline: { nestable: true, priority: 1, exclusive: false },
        strikethrough: { nestable: true, priority: 1, exclusive: false },
        code: { nestable: false, priority: 2, exclusive: true },
        link: { nestable: false, priority: 3, exclusive: true },
        comment: { nestable: false, priority: 4, exclusive: true }
    };

    /**
     * @param {string} id - Unique identifier
     * @param {string} nodeId - Local node identifier
     */
    constructor(id, nodeId) {
        this.id = id;
        this.nodeId = nodeId;
        this.clock = new VectorClock();
        /** @type {Map<string, number>} opId -> timestamp */
        this._appliedOps = new Map();

        // Text layer (character-level RGA)
        this._rga = new RGA(`${id}:text`, nodeId);

        /**
         * Formatting marks: charIndex → Map<markType, {value, timestamp, writerNodeId}>
         * @type {Map<string, Map<string, {value: *, timestamp: number, writerNodeId: string}>>}
         */
        this._marks = new Map();

        /**
         * Block types: blockIndex → { type, metadata, timestamp, writerNodeId }
         * @type {Map<number, {type: string, metadata: object, timestamp: number, writerNodeId: string}>}
         */
        this._blocks = new Map();
    }

    _applyMarkWithRules(charMarks, mark, value, timestamp, writerNodeId) {
        const newDef = RichText.MARK_TYPES[mark] || { nestable: true, priority: 1, exclusive: false };
        let canApply = true;

        // 1. Resolve conflicts with different marks (e.g. link vs code)
        for (const [existingMark, existingData] of charMarks.entries()) {
            if (existingMark === mark) continue;

            const existingDef = RichText.MARK_TYPES[existingMark] || { nestable: true, priority: 1, exclusive: false };

            if (newDef.exclusive || existingDef.exclusive || !newDef.nestable || !existingDef.nestable) {
                if (newDef.priority < existingDef.priority) {
                    canApply = false;
                } else if (newDef.priority > existingDef.priority) {
                    charMarks.delete(existingMark);
                } else {
                    if (this._shouldReplace(existingData, { timestamp, writerNodeId })) {
                        charMarks.delete(existingMark);
                    } else {
                        canApply = false;
                    }
                }
            }
        }

        // 2. Resolve conflicts with the same mark (LWW) and apply
        if (canApply) {
            const existing = charMarks.get(mark);
            if (!existing || this._shouldReplace(existing, { timestamp, writerNodeId })) {
                if (value === null || value === false) {
                    charMarks.delete(mark); // Support removing marks
                } else {
                    charMarks.set(mark, { value, timestamp, writerNodeId });
                }
            }
        }
    }

    /**
     * Insert text at a visible character position.
     * @param {number} index
     * @param {string} text
     * @returns {Operation[]}
     */
    insertText(index, text) {
        const ops = [];
        for (let i = 0; i < text.length; i++) {
            const rgaOp = this._rga.insert(index + i, text[i]);
            this.clock.increment(this.nodeId);

            const op = new Operation({
                type: 'richtext:insert',
                crdtId: this.id,
                nodeId: this.nodeId,
                clock: this.clock.get(this.nodeId),
                causalDeps: this.clock.toJSON(),
                data: { rgaOp: rgaOp.toJSON() },
            });
            this._appliedOps.set(op.opId, Date.now());
            ops.push(op);
        }
        return ops;
    }

    /**
     * Delete text at a visible character position.
     * @param {number} index
     * @param {number} [count=1]
     * @returns {Operation[]}
     */
    deleteText(index, count = 1) {
        const ops = [];
        for (let i = 0; i < count; i++) {
            const rgaOp = this._rga.delete(index);
            this.clock.increment(this.nodeId);

            const op = new Operation({
                type: 'richtext:delete',
                crdtId: this.id,
                nodeId: this.nodeId,
                clock: this.clock.get(this.nodeId),
                causalDeps: this.clock.toJSON(),
                data: { rgaOp: rgaOp.toJSON() },
            });
            this._appliedOps.set(op.opId, Date.now());
            ops.push(op);
        }
        return ops;
    }

    /**
     * Apply a formatting mark to a range of characters.
     * Uses LWW for concurrent format conflicts.
     *
     * @param {number} start - Start index (inclusive)
     * @param {number} end - End index (exclusive)
     * @param {string} mark - Mark type ('bold', 'italic', 'code', 'link', etc.)
     * @param {*} value - Mark value (true, false, url string, etc.)
     * @returns {Operation}
     */
    applyFormat(start, end, mark, value) {
        const timestamp = Date.now();
        this.clock.increment(this.nodeId);

        // Get the element IDs at the current positions for CRDT-stable references
        const elements = this._rga._elements.filter((e) => !e.deleted);
        const startElemId = elements[start]
            ? `${elements[start].elemId.nodeId}:${elements[start].elemId.seq}`
            : null;
        const endElemId = elements[Math.min(end - 1, elements.length - 1)]
            ? `${elements[Math.min(end - 1, elements.length - 1)].elemId.nodeId}:${elements[Math.min(end - 1, elements.length - 1)].elemId.seq}`
            : null;

        // Apply locally
        for (let i = start; i < Math.min(end, elements.length); i++) {
            const elemKey = `${elements[i].elemId.nodeId}:${elements[i].elemId.seq}`;
            if (!this._marks.has(elemKey)) {
                this._marks.set(elemKey, new Map());
            }

            const charMarks = this._marks.get(elemKey);
            this._applyMarkWithRules(charMarks, mark, value, timestamp, this.nodeId);
        }

        const op = new Operation({
            type: 'richtext:format',
            crdtId: this.id,
            nodeId: this.nodeId,
            clock: this.clock.get(this.nodeId),
            causalDeps: this.clock.toJSON(),
            data: { start, end, startElemId, endElemId, mark, value, timestamp },
        });

        this._appliedOps.set(op.opId, Date.now());
        return op;
    }

    /**
     * Set the block type for a block (paragraph, heading, list, etc.).
     * @param {number} blockIndex - Block index (0-based)
     * @param {string} type - Block type ('paragraph', 'heading', 'list-item', 'code-block', 'quote')
     * @param {object} [metadata={}] - Block metadata (e.g., { level: 2 } for headings)
     * @returns {Operation}
     */
    setBlockType(blockIndex, type, metadata = {}) {
        const timestamp = Date.now();
        this.clock.increment(this.nodeId);

        const existing = this._blocks.get(blockIndex);
        if (!existing || this._shouldReplace(existing, { timestamp, writerNodeId: this.nodeId })) {
            this._blocks.set(blockIndex, { type, metadata, timestamp, writerNodeId: this.nodeId });
        }

        const op = new Operation({
            type: 'richtext:block',
            crdtId: this.id,
            nodeId: this.nodeId,
            clock: this.clock.get(this.nodeId),
            causalDeps: this.clock.toJSON(),
            data: { blockIndex, blockType: type, metadata, timestamp },
        });

        this._appliedOps.set(op.opId, Date.now());
        return op;
    }

    /**
     * Apply a remote operation.
     * @param {Operation} op
     * @returns {boolean}
     */
    apply(op) {
        if (this._appliedOps.has(op.opId)) return false;

        // Phase 4: Strict Sequence Replay Protection
        if (op.clock <= this.clock.get(op.nodeId)) return false;

        this._appliedOps.set(op.opId, Date.now());
        this.clock.merge(VectorClock.fromJSON(op.causalDeps));

        switch (op.type) {
            case 'richtext:insert':
            case 'richtext:delete': {
                // Reconstruct the RGA operation and apply it
                const rgaOp = Operation.fromJSON(op.data.rgaOp);
                this._rga.apply(rgaOp);
                break;
            }

            case 'richtext:format': {
                const { mark, value, timestamp } = op.data;
                const elements = this._rga._elements.filter((e) => !e.deleted);

                for (let i = op.data.start; i < Math.min(op.data.end, elements.length); i++) {
                    const elemKey = `${elements[i].elemId.nodeId}:${elements[i].elemId.seq}`;
                    if (!this._marks.has(elemKey)) {
                        this._marks.set(elemKey, new Map());
                    }

                    const charMarks = this._marks.get(elemKey);
                    this._applyMarkWithRules(charMarks, mark, value, timestamp, op.nodeId);
                }
                break;
            }

            case 'richtext:block': {
                const { blockIndex, blockType, metadata, timestamp } = op.data;
                const existing = this._blocks.get(blockIndex);

                if (!existing || this._shouldReplace(existing, { timestamp, writerNodeId: op.nodeId })) {
                    this._blocks.set(blockIndex, {
                        type: blockType,
                        metadata,
                        timestamp,
                        writerNodeId: op.nodeId,
                    });
                }
                break;
            }

            default:
                throw new Error(`RichText cannot apply: ${op.type}`);
        }

        return true;
    }

    /**
     * LWW conflict resolution.
     */
    _shouldReplace(existing, incoming) {
        if (incoming.timestamp > existing.timestamp) return true;
        if (incoming.timestamp === existing.timestamp) {
            // Same node: later call always wins (causal ordering)
            if (incoming.writerNodeId === existing.writerNodeId) return true;
            // Different node: tie-break by nodeId
            return incoming.writerNodeId > existing.writerNodeId;
        }
        return false;
    }

    // ─── Query API ──────────────────────────────────────────────

    /**
     * Get the plain text content.
     * @returns {string}
     */
    getText() {
        return this._rga.toString();
    }

    /**
     * Get the text length.
     * @returns {number}
     */
    get length() {
        return this._rga.length;
    }

    /**
     * Get formatting marks for a character at the given index.
     * @param {number} index
     * @returns {Record<string, *>}
     */
    getMarksAt(index) {
        const elements = this._rga._elements.filter((e) => !e.deleted);
        if (index >= elements.length) return {};

        const elemKey = `${elements[index].elemId.nodeId}:${elements[index].elemId.seq}`;
        const marks = this._marks.get(elemKey);
        if (!marks) return {};

        const result = {};
        for (const [markType, { value }] of marks) {
            if (value !== false && value !== null) {
                result[markType] = value;
            }
        }
        return result;
    }

    /**
     * Get the block type for a block index.
     * @param {number} blockIndex
     * @returns {{ type: string, metadata: object }}
     */
    getBlockType(blockIndex) {
        const block = this._blocks.get(blockIndex);
        return block
            ? { type: block.type, metadata: block.metadata }
            : { type: 'paragraph', metadata: {} };
    }

    /**
     * Get all blocks with their text content and formatting.
     * @returns {Array<{ type: string, metadata: object, text: string, marks: Array }>}
     */
    getBlocks() {
        const text = this.getText();
        const lines = text.split('\n');
        const blocks = [];
        let offset = 0;

        for (let i = 0; i < lines.length; i++) {
            const blockType = this.getBlockType(i);
            const marks = [];

            for (let j = 0; j < lines[i].length; j++) {
                marks.push(this.getMarksAt(offset + j));
            }

            blocks.push({
                type: blockType.type,
                metadata: blockType.metadata,
                text: lines[i],
                marks,
            });

            offset += lines[i].length + 1; // +1 for newline
        }

        return blocks;
    }

    /**
     * Export to simple HTML.
     * @returns {string}
     */
    toHTML() {
        const blocks = this.getBlocks();
        return blocks
            .map((block) => {
                let content = '';
                let i = 0;

                while (i < block.text.length) {
                    const marks = block.marks[i] || {};
                    let span = block.text[i];

                    // Group consecutive characters with same marks
                    while (i + 1 < block.text.length) {
                        const nextMarks = block.marks[i + 1] || {};
                        if (JSON.stringify(marks) === JSON.stringify(nextMarks)) {
                            i++;
                            span += block.text[i];
                        } else {
                            break;
                        }
                    }

                    // Wrap with formatting tags
                    let formatted = this._escapeHTML(span);
                    if (marks.code) formatted = `<code>${formatted}</code>`;
                    if (marks.bold) formatted = `<b>${formatted}</b>`;
                    if (marks.italic) formatted = `<i>${formatted}</i>`;
                    if (marks.underline) formatted = `<u>${formatted}</u>`;
                    if (marks.strikethrough) formatted = `<s>${formatted}</s>`;
                    if (marks.link) formatted = `<a href="${this._escapeHTML(marks.link)}">${formatted}</a>`;

                    content += formatted;
                    i++;
                }

                // Wrap in block tag
                switch (block.type) {
                    case 'heading':
                        const level = block.metadata.level || 1;
                        return `<h${level}>${content}</h${level}>`;
                    case 'list-item':
                        return `<li>${content}</li>`;
                    case 'code-block':
                        return `<pre><code>${content}</code></pre>`;
                    case 'quote':
                        return `<blockquote>${content}</blockquote>`;
                    default:
                        return `<p>${content}</p>`;
                }
            })
            .join('\n');
    }

    _escapeHTML(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ─── Serialization ──────────────────────────────────────────

    toJSON() {
        return {
            id: this.id,
            nodeId: this.nodeId,
            rga: this._rga.toJSON(),
            marks: [...this._marks.entries()].map(([key, markMap]) => [
                key,
                [...markMap.entries()],
            ]),
            blocks: [...this._blocks.entries()],
            clock: this.clock.toJSON(),
            appliedOps: [...this._appliedOps.entries()],
        };
    }

    static fromJSON(data) {
        const rt = new RichText(data.id, data.nodeId);
        rt._rga = RGA.fromJSON(data.rga);
        rt._marks = new Map(
            data.marks.map(([key, entries]) => [key, new Map(entries)]),
        );
        rt._blocks = new Map(data.blocks);
        rt.clock = VectorClock.fromJSON(data.clock);
        if (data.appliedOps) {
            rt._appliedOps = new Map(data.appliedOps);
        }
        return rt;
    }

    /**
     * Get stats.
     * @returns {object}
     */
    stats() {
        const textStats = this._rga.stats();
        return {
            text: textStats,
            marks: this._marks.size,
            blocks: this._blocks.size,
            appliedOps: this._appliedOps.size,
        };
    }

    /**
     * Prune the applied-ops deduplication cache.
     * Prevents snapshot bloat by removing opIds older than `maxAgeMs`.
     * Safety is maintained via the Lamport clock (sequence filtering).
     *
     * @param {number} [maxAgeMs=604800000] - Default 7 days
     * @returns {number}
     */
    pruneOpHistory(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
        if (this._appliedOps.size === 0) return 0;

        // Prune the internal RGA as well
        this._rga.pruneOpHistory(maxAgeMs);

        const now = Date.now();
        let pruneCount = 0;

        for (const [opId, timestamp] of this._appliedOps.entries()) {
            if (now - timestamp > maxAgeMs) {
                this._appliedOps.delete(opId);
                pruneCount++;
            }
        }

        return pruneCount;
    }
}
