import { describe, it, expect } from 'vitest';
import { RichText } from '../../src/core/RichText.js';

describe('RichText — Block-based Rich Text CRDT', () => {
    it('should insert text', () => {
        const doc = new RichText('doc-1', 'nodeA');
        doc.insertText(0, 'Hello World');
        expect(doc.getText()).toBe('Hello World');
        expect(doc.length).toBe(11);
    });

    it('should delete text', () => {
        const doc = new RichText('doc-1', 'nodeA');
        doc.insertText(0, 'Hello World');
        doc.deleteText(5, 6); // delete " World"
        expect(doc.getText()).toBe('Hello');
    });

    it('should apply bold formatting', () => {
        const doc = new RichText('doc-1', 'nodeA');
        doc.insertText(0, 'Hello World');
        doc.applyFormat(0, 5, 'bold', true);

        expect(doc.getMarksAt(0)).toEqual({ bold: true });
        expect(doc.getMarksAt(4)).toEqual({ bold: true });
        expect(doc.getMarksAt(5)).toEqual({}); // space is not bold
    });

    it('should apply multiple formatting marks', () => {
        const doc = new RichText('doc-1', 'nodeA');
        doc.insertText(0, 'Hello');
        doc.applyFormat(0, 5, 'bold', true);
        doc.applyFormat(0, 5, 'italic', true);

        expect(doc.getMarksAt(0)).toEqual({ bold: true, italic: true });
    });

    it('should remove formatting with false', () => {
        const doc = new RichText('doc-1', 'nodeA');
        doc.insertText(0, 'Hello');
        doc.applyFormat(0, 5, 'bold', true);
        doc.applyFormat(0, 5, 'bold', false);

        expect(doc.getMarksAt(0)).toEqual({});
    });

    it('should set block types', () => {
        const doc = new RichText('doc-1', 'nodeA');
        doc.insertText(0, 'Title');
        doc.setBlockType(0, 'heading', { level: 1 });

        expect(doc.getBlockType(0)).toEqual({ type: 'heading', metadata: { level: 1 } });
    });

    it('should default to paragraph block type', () => {
        const doc = new RichText('doc-1', 'nodeA');
        expect(doc.getBlockType(0)).toEqual({ type: 'paragraph', metadata: {} });
    });

    it('should generate HTML', () => {
        const doc = new RichText('doc-1', 'nodeA');
        doc.insertText(0, 'Hello');
        doc.applyFormat(0, 5, 'bold', true);
        doc.setBlockType(0, 'heading', { level: 1 });

        const html = doc.toHTML();
        expect(html).toContain('<h1>');
        expect(html).toContain('<b>Hello</b>');
        expect(html).toContain('</h1>');
    });

    it('should handle code blocks', () => {
        const doc = new RichText('doc-1', 'nodeA');
        doc.insertText(0, 'const x = 1;');
        doc.setBlockType(0, 'code-block');

        const html = doc.toHTML();
        expect(html).toContain('<pre><code>');
    });

    it('should handle link formatting', () => {
        const doc = new RichText('doc-1', 'nodeA');
        doc.insertText(0, 'Click here');
        doc.applyFormat(0, 10, 'link', 'https://example.com');

        expect(doc.getMarksAt(0).link).toBe('https://example.com');
        const html = doc.toHTML();
        expect(html).toContain('href="https://example.com"');
    });

    it('should apply remote operations', () => {
        const doc1 = new RichText('doc-1', 'nodeA');
        const doc2 = new RichText('doc-1', 'nodeB');

        const insertOps = doc1.insertText(0, 'Hello');
        for (const op of insertOps) doc2.apply(op);

        expect(doc2.getText()).toBe('Hello');
    });

    it('should apply remote format operations', () => {
        const doc1 = new RichText('doc-1', 'nodeA');
        const doc2 = new RichText('doc-1', 'nodeB');

        const insertOps = doc1.insertText(0, 'Hello');
        for (const op of insertOps) doc2.apply(op);

        const fmtOp = doc1.applyFormat(0, 5, 'bold', true);
        doc2.apply(fmtOp);

        expect(doc2.getMarksAt(0)).toEqual({ bold: true });
    });

    it('should apply remote block operations', () => {
        const doc1 = new RichText('doc-1', 'nodeA');
        const doc2 = new RichText('doc-1', 'nodeB');

        const blockOp = doc1.setBlockType(0, 'heading', { level: 2 });
        doc2.apply(blockOp);

        expect(doc2.getBlockType(0)).toEqual({ type: 'heading', metadata: { level: 2 } });
    });

    it('should deduplicate operations', () => {
        const doc1 = new RichText('doc-1', 'nodeA');
        const doc2 = new RichText('doc-1', 'nodeB');

        const ops = doc1.insertText(0, 'Hi');
        for (const op of ops) doc2.apply(op);
        // Apply again — should be deduplicated
        for (const op of ops) expect(doc2.apply(op)).toBe(false);

        expect(doc2.getText()).toBe('Hi');
    });

    it('should serialize and restore', () => {
        const doc = new RichText('doc-1', 'nodeA');
        doc.insertText(0, 'Hello');
        doc.applyFormat(0, 5, 'bold', true);
        doc.setBlockType(0, 'heading', { level: 1 });

        const json = doc.toJSON();
        const restored = RichText.fromJSON(json);

        expect(restored.getText()).toBe('Hello');
        expect(restored.getMarksAt(0)).toEqual({ bold: true });
        expect(restored.getBlockType(0)).toEqual({ type: 'heading', metadata: { level: 1 } });
    });

    it('should get blocks with text and marks', () => {
        const doc = new RichText('doc-1', 'nodeA');
        doc.insertText(0, 'Line 1\nLine 2');
        doc.setBlockType(0, 'heading', { level: 1 });

        const blocks = doc.getBlocks();
        expect(blocks.length).toBe(2);
        expect(blocks[0].type).toBe('heading');
        expect(blocks[0].text).toBe('Line 1');
        expect(blocks[1].type).toBe('paragraph');
        expect(blocks[1].text).toBe('Line 2');
    });

    it('should report stats', () => {
        const doc = new RichText('doc-1', 'nodeA');
        doc.insertText(0, 'Hello');
        doc.applyFormat(0, 3, 'bold', true);

        const stats = doc.stats();
        expect(stats.textLength).toBe(5);
        expect(stats.formattedChars).toBe(3);
        expect(stats.appliedOps).toBeGreaterThan(0);
    });

    it('should escape HTML in content', () => {
        const doc = new RichText('doc-1', 'nodeA');
        doc.insertText(0, '<script>alert("xss")</script>');

        const html = doc.toHTML();
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });
});
