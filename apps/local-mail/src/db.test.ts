/**
 * The mirror's write contract. Unlike `apps/local-books`' monotonic-timestamp
 * guard (QuickBooks CDC deletes are stubs, so a stale write must not regress a
 * newer row), Gmail's history stream is applied strictly in the order it is
 * received within one process, so `upsertMessage`/`applyHistoryBatch` are
 * plain last-write-wins: what these tests actually cover is the FULL-pull vs
 * INCREMENTAL-patch split (a `labelPatch` must edit `raw.labelIds` in place
 * and leave the rest of the blob alone) and the soft-delete/atomic-cursor
 * discipline ported from `db.ts`.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type MailDb, openMailDb } from './db.ts';
import type { GmailMessage } from './schema.ts';

function tempDir() {
	const dir = mkdtempSync(join(tmpdir(), 'local-mail-test-'));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function openTmp(): { db: MailDb; cleanup: () => void } {
	const tmp = tempDir();
	const db = openMailDb(join(tmp.dir, 'mail.db'));
	return {
		db,
		cleanup: () => {
			db.close();
			tmp.cleanup();
		},
	};
}

function message(over: Partial<GmailMessage> = {}): GmailMessage {
	return {
		id: 'm1',
		threadId: 't1',
		labelIds: ['INBOX', 'UNREAD'],
		snippet: 'hello there',
		internalDate: '1719000000000',
		payload: {
			headers: [
				{ name: 'Subject', value: 'Test subject' },
				{ name: 'From', value: 'sender@example.com' },
			],
		},
		...over,
	};
}

function messageRow(db: MailDb, id: string) {
	return db.raw
		.query<
			{
				raw: string;
				thread_id: string;
				snippet: string;
				label_ids: string;
				subject: string | null;
				sender: string | null;
				deleted: number;
			},
			[string]
		>(
			`SELECT raw, thread_id, snippet, label_ids, subject, sender, deleted FROM messages WHERE id = ?`,
		)
		.get(id);
}

describe('full pull page ingestion', () => {
	test('upserts a message, projects generated columns, and computes header columns', () => {
		const { db, cleanup } = openTmp();
		db.ingestFullPullPage([message()], 's1');

		const row = messageRow(db, 'm1');
		expect(row?.thread_id).toBe('t1');
		expect(row?.snippet).toBe('hello there');
		expect(row?.subject).toBe('Test subject');
		expect(row?.sender).toBe('sender@example.com');
		expect(JSON.parse(row?.label_ids ?? '[]')).toEqual(['INBOX', 'UNREAD']);
		expect(row?.deleted).toBe(0);
		cleanup();
	});

	test('also upserts a thread stub keyed by threadId', () => {
		const { db, cleanup } = openTmp();
		db.ingestFullPullPage([message()], 's1');

		const thread = db.raw
			.query<{ id: string; last_message_id: string }, [string]>(
				`SELECT id, last_message_id FROM threads WHERE id = ?`,
			)
			.get('t1');
		expect(thread?.last_message_id).toBe('m1');
		cleanup();
	});

	test('finishFullPull records the historyId baseline and timestamps', () => {
		const { db, cleanup } = openTmp();
		db.finishFullPull('500', 's1');
		const state = db.readRealmState();
		expect(state.historyId).toBe('500');
		expect(state.lastFullPullAt).toBe('s1');
		expect(state.lastSyncedAt).toBe('s1');
		cleanup();
	});
});

describe('applyHistoryBatch', () => {
	test('upserts new messages and advances the cursor', () => {
		const { db, cleanup } = openTmp();
		db.applyHistoryBatch({
			messagesToUpsert: [message()],
			messagesToDelete: [],
			labelPatches: [],
			newHistoryId: '600',
			syncedAt: 's2',
		});
		expect(messageRow(db, 'm1')).not.toBeNull();
		expect(db.readRealmState().historyId).toBe('600');
		cleanup();
	});

	test('a labelPatch edits raw.labelIds in place, leaving the rest of the blob untouched', () => {
		const { db, cleanup } = openTmp();
		db.ingestFullPullPage([message()], 's1');

		db.applyHistoryBatch({
			messagesToUpsert: [],
			messagesToDelete: [],
			labelPatches: [{ messageId: 'm1', labelIds: ['INBOX', 'IMPORTANT'] }],
			newHistoryId: '601',
			syncedAt: 's2',
		});

		const row = messageRow(db, 'm1');
		expect(JSON.parse(row?.label_ids ?? '[]')).toEqual(['INBOX', 'IMPORTANT']);
		// The subject/sender columns are plain (not re-derived from a patch), so a
		// labelPatch alone must not touch them.
		expect(row?.subject).toBe('Test subject');
		const raw = JSON.parse(row?.raw ?? '{}');
		expect(raw.snippet).toBe('hello there');
		cleanup();
	});

	test('a labelPatch for a message not yet mirrored is silently skipped', () => {
		const { db, cleanup } = openTmp();
		db.applyHistoryBatch({
			messagesToUpsert: [],
			messagesToDelete: [],
			labelPatches: [{ messageId: 'unknown', labelIds: ['INBOX'] }],
			newHistoryId: '602',
			syncedAt: 's1',
		});
		expect(messageRow(db, 'unknown')).toBeNull();
		expect(db.readRealmState().historyId).toBe('602');
		cleanup();
	});

	test('messagesDeleted soft-deletes and preserves the last-known blob', () => {
		const { db, cleanup } = openTmp();
		db.ingestFullPullPage([message()], 's1');

		db.applyHistoryBatch({
			messagesToUpsert: [],
			messagesToDelete: ['m1'],
			labelPatches: [],
			newHistoryId: '603',
			syncedAt: 's2',
		});

		const row = messageRow(db, 'm1');
		expect(row?.deleted).toBe(1);
		expect(row?.subject).toBe('Test subject'); // blob preserved, not wiped
		cleanup();
	});

	test('cursor and all mutations commit atomically (one transaction)', () => {
		const { db, cleanup } = openTmp();
		db.applyHistoryBatch({
			messagesToUpsert: [message({ id: 'm2' })],
			messagesToDelete: [],
			labelPatches: [],
			newHistoryId: '700',
			syncedAt: 's1',
		});
		const state = db.readRealmState();
		expect(state.historyId).toBe('700');
		expect(state.lastSyncedAt).toBe('s1');
		expect(messageRow(db, 'm2')).not.toBeNull();
		cleanup();
	});
});

describe('labels', () => {
	test('ingestLabels upserts the label set', () => {
		const { db, cleanup } = openTmp();
		db.ingestLabels(
			[
				{ id: 'INBOX', name: 'INBOX', type: 'system' },
				{ id: 'Label_1', name: 'Work', type: 'user' },
			],
			's1',
		);
		const rows = db.raw
			.query<{ id: string; name: string; type: string }, []>(
				`SELECT id, name, type FROM labels ORDER BY id`,
			)
			.all();
		expect(rows).toEqual([
			{ id: 'INBOX', name: 'INBOX', type: 'system' },
			{ id: 'Label_1', name: 'Work', type: 'user' },
		]);
		cleanup();
	});
});

describe('schema-version migration', () => {
	test('a stale schema_version drops and recreates the data tables in the same open, not a subsequent one', () => {
		const tmp = tempDir();
		const path = join(tmp.dir, 'mail.db');

		const first = openMailDb(path);
		first.ingestFullPullPage([message()], 's1');
		// Simulate an older mirror on disk: force the stored version behind
		// SCHEMA_VERSION so the next open must drop-and-recreate.
		first.raw.exec(`UPDATE _meta SET value = '0' WHERE key = 'schema_version'`);
		first.close();

		// Reopening (not a second, later open) must both drop the stale tables
		// AND recreate them, so a write right after `openMailDb` returns
		// succeeds instead of hitting "no such table".
		const second = openMailDb(path);
		expect(() =>
			second.ingestFullPullPage([message({ id: 'm2' })], 's2'),
		).not.toThrow();
		const row = second.raw
			.query<{ id: string }, [string]>(`SELECT id FROM messages WHERE id = ?`)
			.get('m2');
		expect(row?.id).toBe('m2');
		// The stale mirror's data did not survive the drop (expected: a schema
		// change is a re-pullable-cache invalidation, not a migration).
		expect(
			second.raw
				.query<{ id: string }, [string]>(`SELECT id FROM messages WHERE id = ?`)
				.get('m1'),
		).toBeNull();
		second.close();
		tmp.cleanup();
	});
});
