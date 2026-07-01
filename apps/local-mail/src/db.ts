import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { type GmailLabel, type GmailMessage, headerValue } from './schema.ts';

/**
 * The local mirror: one SQLite file per connected Gmail account. Ports
 * `apps/local-books`' CDC-cursor and transaction discipline (see that file's
 * top comment) onto Gmail's `history.list` shape, which differs from
 * QuickBooks' `/cdc` in ways that shaped the design below:
 *
 * - Gmail's cursor is an opaque, increasing `historyId`, not a timestamp, so
 *   staleness is judged from our own `last_synced_at` wall-clock record, not
 *   from parsing the cursor itself (see `sync.ts`'s `decideMode`).
 * - `history.list`'s `labelsAdded`/`labelsRemoved` records carry a full
 *   current `labelIds` snapshot for a message that may already be mirrored,
 *   not a full object replacement. `patchMessageLabels` handles this as a
 *   targeted field patch, distinct from the generic upsert.
 * - Full backfill is paginated (`messages.list` + per-id `messages.get`), so
 *   it commits per page (`ingestFullPullPage`) rather than accumulating the
 *   whole mailbox in memory before one transaction; the cursor only advances
 *   once, in `finishFullPull`, after every page has committed.
 *
 * Migration is intentionally two-speed, not one blunt `SCHEMA_VERSION` bump
 * for everything: adding an index alone (a query got slow, no row/column
 * shape change) needs nothing but a new `CREATE INDEX IF NOT EXISTS` line
 * below, it runs unconditionally on every open, no version bump, no data
 * loss, no Gmail re-download. Only a row/column SHAPE change needs
 * `SCHEMA_VERSION` bumped, which drops (cascading to that table's indices
 * too) and rebuilds all three tables fresh in the same open, see the version
 * gate below.
 */

export const SCHEMA_VERSION = '1';

const CURSOR_KEYS = [
	'history_id',
	'last_full_pull_at',
	'last_synced_at',
] as const;

export type RealmState = {
	historyId: string | null;
	lastFullPullAt: string | null;
	lastSyncedAt: string | null;
};

export type MailDb = ReturnType<typeof openMailDb>;

export function openMailDb(
	path: string,
	{ readonly = false }: { readonly?: boolean } = {},
) {
	// See `apps/local-books/src/db.ts` for why a read-only handle skips every
	// mutation below: it must never write, and must not fail with SQLITE_BUSY
	// contending for a lock a concurrent sync already holds.
	if (!readonly) mkdirSync(dirname(path), { recursive: true });
	const db = new Database(
		path,
		readonly ? { readonly: true } : { create: true },
	);

	if (readonly) {
		db.exec('PRAGMA busy_timeout = 5000;');
	} else {
		db.exec('PRAGMA journal_mode = WAL;');
		db.exec('PRAGMA busy_timeout = 5000;');
		db.exec('PRAGMA synchronous = NORMAL;');
		db.exec('PRAGMA foreign_keys = ON;');
		db.exec(
			`CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT);`,
		);
	}

	const setMetaStmt = db.query(
		`INSERT INTO _meta (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
	);
	const getMetaStmt = db.query<{ value: string | null }, [string]>(
		`SELECT value FROM _meta WHERE key = ?`,
	);

	// Schema-version gate (writers only), same asymmetric-win reasoning as
	// local-books: the mirror is a re-pullable cache Gmail owns the truth for,
	// so a format change just drops the derived tables and clears the cursor;
	// the next sync rebuilds with one full pull. This MUST run before the
	// CREATE TABLE block below: unlike local-books (which recreates tables
	// lazily inside `ingest`), table creation here happens once at open-time,
	// so a drop that ran after creation would leave the mirror with no tables
	// at all until the next open.
	if (!readonly) {
		const storedVersion = getMetaStmt.get('schema_version')?.value ?? null;
		if (storedVersion !== null && storedVersion !== SCHEMA_VERSION) {
			for (const table of ['messages', 'threads', 'labels']) {
				db.exec(`DROP TABLE IF EXISTS ${table};`);
			}
			db.exec(
				`DELETE FROM _meta WHERE key IN (${CURSOR_KEYS.map((k) => `'${k}'`).join(', ')});`,
			);
		}
		setMetaStmt.run('schema_version', SCHEMA_VERSION);

		db.exec(`
			CREATE TABLE IF NOT EXISTS messages (
				id            TEXT PRIMARY KEY,
				raw           TEXT NOT NULL,
				thread_id     TEXT GENERATED ALWAYS AS (json_extract(raw, '$.threadId')) VIRTUAL,
				snippet       TEXT GENERATED ALWAYS AS (json_extract(raw, '$.snippet')) VIRTUAL,
				label_ids     TEXT GENERATED ALWAYS AS (json_extract(raw, '$.labelIds')) VIRTUAL,
				internal_date TEXT GENERATED ALWAYS AS (json_extract(raw, '$.internalDate')) VIRTUAL,
				subject       TEXT,
				sender        TEXT,
				synced_at     TEXT NOT NULL,
				deleted       INTEGER NOT NULL DEFAULT 0
			);
			CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);
			CREATE INDEX IF NOT EXISTS idx_messages_internal_date ON messages(internal_date);

			CREATE TABLE IF NOT EXISTS threads (
				id               TEXT PRIMARY KEY,
				last_message_id  TEXT NOT NULL,
				snippet          TEXT,
				synced_at        TEXT NOT NULL
			);

			CREATE TABLE IF NOT EXISTS labels (
				id         TEXT PRIMARY KEY,
				raw        TEXT NOT NULL,
				name       TEXT GENERATED ALWAYS AS (json_extract(raw, '$.name')) VIRTUAL,
				type       TEXT GENERATED ALWAYS AS (json_extract(raw, '$.type')) VIRTUAL,
				synced_at  TEXT NOT NULL
			);
		`);
	}

	const upsertMessageStmt = db.query(
		`INSERT INTO messages (id, raw, subject, sender, synced_at, deleted)
		 VALUES (?, ?, ?, ?, ?, 0)
		 ON CONFLICT(id) DO UPDATE SET
		   raw = excluded.raw,
		   subject = excluded.subject,
		   sender = excluded.sender,
		   synced_at = excluded.synced_at,
		   deleted = 0`,
	);
	const markMessageDeletedStmt = db.query(
		`UPDATE messages SET deleted = 1, synced_at = ? WHERE id = ?`,
	);
	const getMessageRawStmt = db.query<{ raw: string }, [string]>(
		`SELECT raw FROM messages WHERE id = ? AND deleted = 0`,
	);
	const patchMessageLabelsStmt = db.query(
		`UPDATE messages SET raw = ?, synced_at = ? WHERE id = ? AND deleted = 0`,
	);
	const upsertThreadStmt = db.query(
		`INSERT INTO threads (id, last_message_id, snippet, synced_at)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   last_message_id = excluded.last_message_id,
		   snippet = excluded.snippet,
		   synced_at = excluded.synced_at`,
	);
	const upsertLabelStmt = db.query(
		`INSERT INTO labels (id, raw, synced_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET raw = excluded.raw, synced_at = excluded.synced_at`,
	);

	function readRealmState(): RealmState {
		return {
			historyId: getMetaStmt.get('history_id')?.value ?? null,
			lastFullPullAt: getMetaStmt.get('last_full_pull_at')?.value ?? null,
			lastSyncedAt: getMetaStmt.get('last_synced_at')?.value ?? null,
		};
	}

	function upsertMessage(message: GmailMessage, syncedAt: string): void {
		upsertMessageStmt.run(
			message.id,
			JSON.stringify(message),
			headerValue(message, 'Subject'),
			headerValue(message, 'From'),
			syncedAt,
		);
		upsertThreadStmt.run(
			message.threadId,
			message.id,
			message.snippet ?? null,
			syncedAt,
		);
	}

	return {
		/** Escape hatch for ad-hoc queries (tests, diagnostics). */
		raw: db,

		readRealmState,

		/**
		 * One page of a full backfill: upsert every message (and its thread
		 * stub), no cursor advance. Called once per `messages.list` page so a
		 * crash mid-backfill loses only the in-flight page, not the whole pull.
		 */
		ingestFullPullPage(messages: GmailMessage[], syncedAt: string): void {
			const tx = db.transaction(() => {
				for (const message of messages) upsertMessage(message, syncedAt);
			});
			tx.immediate();
		},

		/** Replace the label set (small, returned complete by `labels.list` every call). */
		ingestLabels(labels: GmailLabel[], syncedAt: string): void {
			const tx = db.transaction(() => {
				for (const label of labels) {
					upsertLabelStmt.run(label.id, JSON.stringify(label), syncedAt);
				}
			});
			tx.immediate();
		},

		/**
		 * Closes out a FULL pull: records the `historyId` baseline (read from
		 * `users.getProfile` right after the pull completes, per Gmail's own
		 * sync recipe) as the cursor incremental polling starts from next.
		 */
		finishFullPull(historyId: string, syncedAt: string): void {
			const tx = db.transaction(() => {
				setMetaStmt.run('history_id', historyId);
				setMetaStmt.run('last_full_pull_at', syncedAt);
				setMetaStmt.run('last_synced_at', syncedAt);
			});
			tx.immediate();
		},

		/**
		 * Applies one `history.list` batch and advances the cursor, all in one
		 * transaction (whole-batch atomic, same as local-books' `ingest`): a
		 * crash rolls back to the prior `historyId` and the next pass re-pulls
		 * the window, which is idempotent (upserts and soft-deletes both are).
		 *
		 * `labelPatches` carries each affected message's CURRENT full `labelIds`
		 * snapshot (that's what `labelsAdded`/`labelsRemoved` records give us),
		 * so it patches the existing row's `raw.labelIds` in place rather than
		 * replacing the row; a patch for a message not yet mirrored is silently
		 * skipped, since that message either arrived via the same or an earlier
		 * `messagesAdded` record, or predates this mirror's cursor and was
		 * already created by the last FULL pull, either way something else is
		 * responsible for creating the row, never this patch.
		 */
		applyHistoryBatch({
			messagesToUpsert,
			messagesToDelete,
			labelPatches,
			newHistoryId,
			syncedAt,
		}: {
			messagesToUpsert: GmailMessage[];
			messagesToDelete: string[];
			labelPatches: { messageId: string; labelIds: string[] }[];
			newHistoryId: string;
			syncedAt: string;
		}): void {
			const tx = db.transaction(() => {
				for (const message of messagesToUpsert)
					upsertMessage(message, syncedAt);
				for (const id of messagesToDelete)
					markMessageDeletedStmt.run(syncedAt, id);
				for (const { messageId, labelIds } of labelPatches) {
					const row = getMessageRawStmt.get(messageId);
					if (!row) continue;
					const patched = { ...JSON.parse(row.raw), labelIds };
					patchMessageLabelsStmt.run(
						JSON.stringify(patched),
						syncedAt,
						messageId,
					);
				}
				setMetaStmt.run('history_id', newHistoryId);
				setMetaStmt.run('last_synced_at', syncedAt);
			});
			tx.immediate();
		},

		close(): void {
			db.close();
		},
	};
}
