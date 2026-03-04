import { describe, it, expect } from 'vitest';
import { TreeKEM } from '../../src/crypto/TreeKEM.js';

describe('TreeKEM — MLS Group Key Agreement', () => {
    it('should create an empty group', () => {
        const group = new TreeKEM('room-1');
        expect(group.size).toBe(0);
        expect(group.members).toEqual([]);
        expect(group.epoch).toBe(0);
    });

    it('should add a member and derive a group key', async () => {
        const group = new TreeKEM('room-1');
        const idx = await group.addMember('alice');
        expect(idx).toBe(0);
        expect(group.size).toBe(1);
        expect(group.members).toContain('alice');
        expect(group.epoch).toBe(1);

        const key = await group.getGroupKey();
        expect(key).toBeDefined();
        expect(key.type).toBe('secret');
    });

    it('should add multiple members', async () => {
        const group = new TreeKEM('room-1');
        await group.addMember('alice');
        await group.addMember('bob');
        await group.addMember('carol');

        expect(group.size).toBe(3);
        expect(group.members).toEqual(['alice', 'bob', 'carol']);
        expect(group.epoch).toBe(3);
    });

    it('should not duplicate members', async () => {
        const group = new TreeKEM('room-1');
        await group.addMember('alice');
        await group.addMember('alice');
        expect(group.size).toBe(1);
    });

    it('should produce different keys for different epochs', async () => {
        const group = new TreeKEM('room-1');
        await group.addMember('alice');
        const key1 = await group.getGroupKey();
        const raw1 = await crypto.subtle.exportKey('raw', key1);

        await group.addMember('bob');
        const key2 = await group.getGroupKey();
        const raw2 = await crypto.subtle.exportKey('raw', key2);

        // Keys should be different after adding a member
        const buf1 = Buffer.from(raw1);
        const buf2 = Buffer.from(raw2);
        expect(buf1.equals(buf2)).toBe(false);
    });

    it('should remove a member', async () => {
        const group = new TreeKEM('room-1');
        await group.addMember('alice');
        await group.addMember('bob');
        await group.addMember('carol');

        const key1 = await group.getGroupKey();
        const raw1 = await crypto.subtle.exportKey('raw', key1);

        const removed = await group.removeMember('bob');
        expect(removed).toBe(true);
        expect(group.size).toBe(2);
        expect(group.members).not.toContain('bob');

        // Key should change after removal (forward secrecy)
        const key2 = await group.getGroupKey();
        const raw2 = await crypto.subtle.exportKey('raw', key2);
        expect(Buffer.from(raw1).equals(Buffer.from(raw2))).toBe(false);
    });

    it('should handle member key update (post-compromise security)', async () => {
        const group = new TreeKEM('room-1');
        await group.addMember('alice');
        await group.addMember('bob');

        const key1 = await group.getGroupKey();
        const raw1 = await crypto.subtle.exportKey('raw', key1);

        await group.updateMemberKey('alice');

        const key2 = await group.getGroupKey();
        const raw2 = await crypto.subtle.exportKey('raw', key2);

        // Key should change after update
        expect(Buffer.from(raw1).equals(Buffer.from(raw2))).toBe(false);
    });

    it('should serialize to JSON', async () => {
        const group = new TreeKEM('room-1');
        await group.addMember('alice');
        await group.addMember('bob');

        const json = group.toJSON();
        expect(json.groupId).toBe('room-1');
        expect(json.epoch).toBe(2);
        expect(json.members).toEqual(['alice', 'bob']);
        expect(json.size).toBe(2);
    });

    it('should throw when getting key from empty group', async () => {
        const group = new TreeKEM('room-1');
        await expect(group.getGroupKey()).rejects.toThrow('No members');
    });

    it('should handle removing non-existent member', async () => {
        const group = new TreeKEM('room-1');
        const result = await group.removeMember('ghost');
        expect(result).toBe(false);
    });
});
