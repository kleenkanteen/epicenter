/**
 * `syncMailbox` end to end against a fake `GmailClient` (an in-memory mailbox,
 * not an HTTP mock server): exercises the FULL-pull path, the INCREMENTAL
 * history-folding path (`foldHistoryRecords`'s upsert/delete/labelPatch
 * resolution), and the mid-pass fallback to FULL when `history.list` reports
 * an expired cursor.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from './config.ts';
import { type MailDb, openMailDb } from './db.ts';
import { GmailApiError, type GmailClient } from './gmail-client.ts';
import type { GmailMessage, HistoryPage } from './schema.ts';
import { syncMailbox } from './sync.ts';

function tempDb(): { db: MailDb; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), 'local-mail-sync-test-'));
	const db = openMailDb(join(dir, 'mail.db'));
	return {
		db,
		cleanup: () => {
			db.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

function message(id: string, over: Partial<GmailMessage> = {}): GmailMessage {
	return {
		id,
		threadId: `t-${id}`,
		labelIds: ['INBOX'],
		snippet: `snippet ${id}`,
		payload: { headers: [{ name: 'Subject', value: `Subject ${id}` }] },
		...over,
	};
}

/** An in-memory fake standing in for the real HTTP `GmailClient`. */
function createFakeGmailClient(seed: {
	mailbox: Map<string, GmailMessage>;
	historyPages: HistoryPage[];
	profileHistoryId: string;
	labels?: { id: string; name: string; type: string }[];
}): GmailClient {
	let historyCallCount = 0;
	return {
		async listMessageIds() {
			return { data: { ids: [...seed.mailbox.keys()] }, error: null };
		},
		async getMessage(id) {
			const found = seed.mailbox.get(id);
			if (!found) return GmailApiError.Http({ status: 404, body: 'not found' });
			return { data: found, error: null };
		},
		async listHistory() {
			const page = seed.historyPages[historyCallCount];
			historyCallCount += 1;
			if (!page) throw new Error('fake client: no more history pages seeded');
			return { data: page, error: null };
		},
		async listLabels() {
			return { data: seed.labels ?? [], error: null };
		},
		async getProfile() {
			return { data: { historyId: seed.profileHistoryId }, error: null };
		},
	};
}

const config: AppConfig = {
	dataDir: '/tmp/local-mail-test',
	clientId: 'test-client',
	clientSecret: 'test-secret',
	apiBase: 'http://localhost:0',
	tokenUrl: 'http://localhost:0/token',
	historySafeWindowDays: 5,
	fullBackstopDays: 30,
	pageSize: 100,
	credentialsPath: '/tmp/local-mail-test/credentials.json',
	account: null,
};

describe('syncMailbox: FULL pull', () => {
	test('first run pulls every message, labels, and records the profile historyId as cursor', async () => {
		const { db, cleanup } = tempDb();
		const mailbox = new Map([
			['m1', message('m1')],
			['m2', message('m2')],
		]);
		const client = createFakeGmailClient({
			mailbox,
			historyPages: [],
			profileHistoryId: '1000',
			labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }],
		});

		const outcome = await syncMailbox(
			{ db, client, config, now: () => Date.parse('2026-07-01T00:00:00.000Z') },
			{ forceFull: false },
		);

		expect(outcome.mode).toBe('FULL');
		expect(outcome.failure).toBeNull();
		expect(outcome.messagesUpserted).toBe(2);
		expect(outcome.cursorAfter).toBe('1000');
		expect(db.readRealmState().historyId).toBe('1000');

		const row = db.raw
			.query<{ id: string }, [string]>(`SELECT id FROM messages WHERE id = ?`)
			.get('m1');
		expect(row?.id).toBe('m1');
		cleanup();
	});
});

describe('syncMailbox: INCREMENTAL', () => {
	function seededDb(): { db: MailDb; cleanup: () => void } {
		const { db, cleanup } = tempDb();
		db.ingestFullPullPage([message('existing')], '2026-06-30T00:00:00.000Z');
		db.finishFullPull('500', '2026-06-30T00:00:00.000Z');
		return { db, cleanup };
	}

	test('messagesAdded fetches and upserts full content', async () => {
		const { db, cleanup } = seededDb();
		const mailbox = new Map([['new-msg', message('new-msg')]]);
		const client = createFakeGmailClient({
			mailbox,
			historyPages: [
				{
					historyId: '501',
					history: [
						{
							id: 'h1',
							messagesAdded: [
								{ message: { id: 'new-msg', threadId: 't-new-msg' } },
							],
						},
					],
				},
			],
			profileHistoryId: '999', // must not be used; INCREMENTAL doesn't call getProfile
		});

		const outcome = await syncMailbox(
			{ db, client, config, now: () => Date.parse('2026-06-30T01:00:00.000Z') },
			{ forceFull: false },
		);

		expect(outcome.mode).toBe('INCREMENTAL');
		expect(outcome.messagesUpserted).toBe(1);
		expect(outcome.cursorAfter).toBe('501');
		const row = db.raw
			.query<{ id: string }, [string]>(`SELECT id FROM messages WHERE id = ?`)
			.get('new-msg');
		expect(row?.id).toBe('new-msg');
		cleanup();
	});

	test('labelsAdded patches labelIds without a messages.get call', async () => {
		const { db, cleanup } = seededDb();
		const client = createFakeGmailClient({
			mailbox: new Map(), // empty: a fetch here would 404, proving no fetch happens
			historyPages: [
				{
					historyId: '502',
					history: [
						{
							id: 'h1',
							labelsAdded: [
								{
									message: {
										id: 'existing',
										threadId: 't-existing',
										labelIds: ['INBOX', 'IMPORTANT'],
									},
									labelIds: ['IMPORTANT'],
								},
							],
						},
					],
				},
			],
			profileHistoryId: '999',
		});

		const outcome = await syncMailbox(
			{ db, client, config, now: () => Date.parse('2026-06-30T01:00:00.000Z') },
			{ forceFull: false },
		);

		expect(outcome.failure).toBeNull();
		expect(outcome.labelsPatched).toBe(1);
		const row = db.raw
			.query<{ label_ids: string }, [string]>(
				`SELECT label_ids FROM messages WHERE id = ?`,
			)
			.get('existing');
		expect(JSON.parse(row?.label_ids ?? '[]')).toEqual(['INBOX', 'IMPORTANT']);
		cleanup();
	});

	test('messagesDeleted soft-deletes', async () => {
		const { db, cleanup } = seededDb();
		const client = createFakeGmailClient({
			mailbox: new Map(),
			historyPages: [
				{
					historyId: '503',
					history: [
						{
							id: 'h1',
							messagesDeleted: [
								{ message: { id: 'existing', threadId: 't-existing' } },
							],
						},
					],
				},
			],
			profileHistoryId: '999',
		});

		const outcome = await syncMailbox(
			{ db, client, config, now: () => Date.parse('2026-06-30T01:00:00.000Z') },
			{ forceFull: false },
		);

		expect(outcome.messagesDeleted).toBe(1);
		const row = db.raw
			.query<{ deleted: number }, [string]>(
				`SELECT deleted FROM messages WHERE id = ?`,
			)
			.get('existing');
		expect(row?.deleted).toBe(1);
		cleanup();
	});

	test('a no-history-key page (nothing changed) advances the cursor to the same value without touching rows', async () => {
		const { db, cleanup } = seededDb();
		const client = createFakeGmailClient({
			mailbox: new Map(),
			historyPages: [{ historyId: '500', history: undefined }],
			profileHistoryId: '999',
		});

		const outcome = await syncMailbox(
			{ db, client, config, now: () => Date.parse('2026-06-30T01:00:00.000Z') },
			{ forceFull: false },
		);

		expect(outcome.messagesUpserted).toBe(0);
		expect(outcome.messagesDeleted).toBe(0);
		expect(outcome.cursorAfter).toBe('500');
		cleanup();
	});

	test('an expired cursor (404) mid-pass falls back to FULL within the same call', async () => {
		const { db, cleanup } = seededDb();
		const mailbox = new Map([['fresh', message('fresh')]]);
		const client: GmailClient = {
			...createFakeGmailClient({
				mailbox,
				historyPages: [],
				profileHistoryId: '9000',
			}),
			async listHistory() {
				return GmailApiError.HistoryExpired();
			},
		};

		const outcome = await syncMailbox(
			{ db, client, config, now: () => Date.parse('2026-06-30T01:00:00.000Z') },
			{ forceFull: false },
		);

		expect(outcome.mode).toBe('FULL');
		expect(outcome.failure).toBeNull();
		expect(outcome.cursorAfter).toBe('9000');
		expect(db.readRealmState().historyId).toBe('9000');
		cleanup();
	});
});
