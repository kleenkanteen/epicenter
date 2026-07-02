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

import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	type MailDb,
	mailDbPath,
	openMailDb,
	openMailDbReadonly,
} from './db.ts';
import type { GmailMessage } from './schema.ts';

function tempDir() {
	const dir = mkdtempSync(join(tmpdir(), 'local-mail-test-'));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function openTmp(): { db: MailDb; dataDir: string; cleanup: () => void } {
	const tmp = tempDir();
	const db = openMailDb({ dataDir: tmp.dir, accountEmail: 'you@example.com' });
	return {
		db,
		dataDir: tmp.dir,
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
				body_text: string | null;
				deleted: number;
			},
			[string]
		>(
			`SELECT raw, thread_id, snippet, label_ids, subject, sender, body_text, deleted FROM messages WHERE id = ?`,
		)
		.get(id);
}

function base64Url(input: string): string {
	return Buffer.from(input, 'utf8')
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/g, '');
}

function mode(path: string): number {
	return statSync(path).mode & 0o777;
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

	test('finishFullPull records the historyId baseline and timestamps', () => {
		const { db, cleanup } = openTmp();
		db.finishFullPull('500', 's1');
		const state = db.readRealmState();
		expect(state.historyId).toBe('500');
		expect(state.lastFullPullAt).toBe('s1');
		expect(state.lastSyncedAt).toBe('s1');
		cleanup();
	});

	test('same-thread messages ingested newest-first derive the newest live message', () => {
		const { db, cleanup } = openTmp();
		db.ingestFullPullPage(
			[
				message({
					id: 'newest',
					threadId: 'thread-1',
					internalDate: '1000',
					snippet: 'newest snippet',
				}),
				message({
					id: 'older',
					threadId: 'thread-1',
					internalDate: '999',
					snippet: 'older snippet',
				}),
			],
			's1',
		);

		const row = db.raw
			.query<
				{ thread_id: string; last_message_id: string; snippet: string },
				[]
			>(
				`SELECT thread_id, id AS last_message_id, snippet
				 FROM messages
				 WHERE deleted = 0 AND thread_id = 'thread-1'
				 ORDER BY internal_date DESC
				 LIMIT 1`,
			)
			.get();

		expect(row).toEqual({
			thread_id: 'thread-1',
			last_message_id: 'newest',
			snippet: 'newest snippet',
		});
		cleanup();
	});

	test('soft-deleted messages drop out of thread derivation', () => {
		const { db, cleanup } = openTmp();
		db.ingestFullPullPage(
			[
				message({
					id: 'newest',
					threadId: 'thread-1',
					internalDate: '1000',
					snippet: 'newest snippet',
				}),
				message({
					id: 'older',
					threadId: 'thread-1',
					internalDate: '999',
					snippet: 'older snippet',
				}),
			],
			's1',
		);
		db.applyHistoryBatch({
			messagesToUpsert: [],
			messagesToDelete: ['newest'],
			labelPatches: [],
			newHistoryId: '700',
			syncedAt: 's2',
		});

		const row = db.raw
			.query<{ last_message_id: string }, []>(
				`SELECT id AS last_message_id
				 FROM messages
				 WHERE deleted = 0 AND thread_id = 'thread-1'
				 ORDER BY internal_date DESC
				 LIMIT 1`,
			)
			.get();

		expect(row?.last_message_id).toBe('older');
		cleanup();
	});

	test('text/plain MIME part decodes into body_text', () => {
		const { db, cleanup } = openTmp();
		db.ingestFullPullPage(
			[
				message({
					payload: {
						headers: [],
						parts: [
							{
								mimeType: 'text/plain',
								body: { data: base64Url('Plain body text') },
							},
						],
					},
				}),
			],
			's1',
		);

		expect(messageRow(db, 'm1')?.body_text).toBe('Plain body text');
		cleanup();
	});

	test('html-only MIME part falls back to stripped body_text', () => {
		const { db, cleanup } = openTmp();
		db.ingestFullPullPage(
			[
				message({
					payload: {
						headers: [],
						parts: [
							{
								mimeType: 'text/html',
								body: {
									data: base64Url(
										'<html><body><p>Hello <strong>there</strong></p></body></html>',
									),
								},
							},
						],
					},
				}),
			],
			's1',
		);

		expect(messageRow(db, 'm1')?.body_text).toBe('Hello there');
		cleanup();
	});

	test('missing body yields null body_text', () => {
		const { db, cleanup } = openTmp();
		db.ingestFullPullPage([message()], 's1');

		expect(messageRow(db, 'm1')?.body_text).toBeNull();
		cleanup();
	});

	test('counts and recentMessages read live rows, newest first', () => {
		const { db, cleanup } = openTmp();
		db.ingestFullPullPage(
			[
				message({
					id: 'older',
					internalDate: '999',
					payload: {
						headers: [{ name: 'Subject', value: 'Older subject' }],
					},
				}),
				message({
					id: 'newest',
					internalDate: '1000',
					payload: {
						headers: [{ name: 'Subject', value: 'Newest subject' }],
					},
				}),
			],
			's1',
		);
		db.ingestLabels([{ id: 'INBOX', name: 'INBOX', type: 'system' }], 's1');

		expect(db.counts()).toEqual({ messages: 2, labels: 1 });
		expect(db.recentMessages(1)[0]?.subject).toBe('Newest subject');

		db.applyHistoryBatch({
			messagesToUpsert: [],
			messagesToDelete: ['newest'],
			labelPatches: [],
			newHistoryId: '700',
			syncedAt: 's2',
		});
		expect(db.counts().messages).toBe(1);
		expect(db.recentMessages(5).map((row) => row.subject)).toEqual([
			'Older subject',
		]);
		cleanup();
	});

	test('creates data and account dirs as 0700 and db files as 0600', () => {
		const tmp = tempDir();
		chmodSync(tmp.dir, 0o755);
		const accountDir = join(tmp.dir, 'you@example.com');
		const path = join(accountDir, 'mail.db');
		const db = openMailDb({
			dataDir: tmp.dir,
			accountEmail: 'you@example.com',
		});
		db.ingestFullPullPage([message()], 's1');

		expect(mode(tmp.dir)).toBe(0o700);
		expect(mode(accountDir)).toBe(0o700);
		expect(mode(path)).toBe(0o600);
		expect(mode(`${path}-wal`)).toBe(0o600);
		expect(mode(`${path}-shm`)).toBe(0o600);
		db.close();
		tmp.cleanup();
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
	test('ingestLabels replaces the label set', () => {
		const { db, cleanup } = openTmp();
		db.ingestLabels(
			[
				{ id: 'INBOX', name: 'INBOX', type: 'system' },
				{ id: 'Label_1', name: 'Work', type: 'user' },
			],
			's1',
		);
		db.ingestLabels(
			[{ id: 'INBOX', name: 'Inbox renamed', type: 'system' }],
			's2',
		);
		const rows = db.raw
			.query<{ id: string; name: string; type: string }, []>(
				`SELECT id, name, type FROM labels ORDER BY id`,
			)
			.all();
		expect(rows).toEqual([
			{ id: 'INBOX', name: 'Inbox renamed', type: 'system' },
		]);
		cleanup();
	});
});

describe('readonly open', () => {
	test('a stale-schema mirror opens readonly without touching the current column set', () => {
		// Hand-build a v1-shaped mirror: no body_text column, a threads table,
		// TEXT internal_date. A readonly consumer (`status` before the first
		// post-upgrade sync) must read it without throwing; only the next
		// writer open migrates.
		const tmp = tempDir();
		const accountDir = join(tmp.dir, 'you@example.com');
		mkdirSync(accountDir, { recursive: true });
		const path = join(accountDir, 'mail.db');
		const old = new Database(path, { create: true });
		old.exec(`
			CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT);
			CREATE TABLE messages (
				id TEXT PRIMARY KEY,
				raw TEXT NOT NULL,
				subject TEXT,
				sender TEXT,
				synced_at TEXT NOT NULL,
				deleted INTEGER NOT NULL DEFAULT 0
			);
			CREATE TABLE threads (id TEXT PRIMARY KEY, raw TEXT NOT NULL);
			CREATE TABLE labels (id TEXT PRIMARY KEY, raw TEXT NOT NULL, synced_at TEXT NOT NULL);
			INSERT INTO _meta (key, value) VALUES ('schema_version', '1'), ('history_id', '42');
			INSERT INTO messages (id, raw, synced_at) VALUES ('m1', '{}', 's1');
		`);
		old.close();

		const reader = openMailDbReadonly({
			dataDir: tmp.dir,
			accountEmail: 'you@example.com',
		});
		expect(reader.schemaVersion()).toBe('1');
		expect(reader.realmState().historyId).toBe('42');
		expect(reader.counts()).toEqual({ messages: 1, labels: 0 });
		reader.close();
		tmp.cleanup();
	});

	test('the readonly handle rejects writes', () => {
		const { db, dataDir, cleanup } = openTmp();
		db.ingestFullPullPage([message()], 's1');
		const reader = openMailDbReadonly({
			dataDir,
			accountEmail: 'you@example.com',
		});
		expect(() => reader.raw.exec(`DELETE FROM messages`)).toThrow();
		reader.close();
		cleanup();
	});
});

describe('mirror layout', () => {
	test('an account email that is not one path segment cannot name a mirror directory', () => {
		expect(() => mailDbPath('/data', '../evil')).toThrow(
			'cannot name a mirror directory',
		);
		expect(() => mailDbPath('/data', 'a/b@example.com')).toThrow(
			'cannot name a mirror directory',
		);
		expect(() => mailDbPath('/data', '')).toThrow(
			'cannot name a mirror directory',
		);
		expect(mailDbPath('/data', 'you@example.com')).toBe(
			join('/data', 'you@example.com', 'mail.db'),
		);
	});
});

describe('schema-version migration', () => {
	test('a stale schema_version drops and recreates the data tables in the same open, not a subsequent one', () => {
		const tmp = tempDir();
		const location = { dataDir: tmp.dir, accountEmail: 'you@example.com' };

		const first = openMailDb(location);
		first.ingestFullPullPage([message()], 's1');
		// Simulate an older mirror on disk: force the stored version behind
		// SCHEMA_VERSION so the next open must drop-and-recreate.
		first.raw.exec(`UPDATE _meta SET value = '0' WHERE key = 'schema_version'`);
		first.close();

		// Reopening (not a second, later open) must both drop the stale tables
		// AND recreate them, so a write right after `openMailDb` returns
		// succeeds instead of hitting "no such table".
		const second = openMailDb(location);
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
		expect(
			second.raw
				.query<{ name: string }, []>(
					`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'threads'`,
				)
				.get(),
		).toBeNull();
		second.close();
		tmp.cleanup();
	});
});
