/**
 * First-sign-in migration: move this device's signed-out local doc into the
 * signed-in, owner-partitioned synced doc (ADR-0088).
 *
 * Flag-free: the local data itself is the state. On each signed-in boot the
 * app probes the local doc for any migratable rows; a non-empty table opens
 * the dialog, which nags again next boot until the user picks Add or Delete.
 * "Add" copies local rows into the owner doc (idempotent by id) then deletes
 * the plaintext local copy, so the deletion both removes the lingering
 * plaintext duplicate AND is why no "migrated" flag is needed (the tables
 * drop to 0).
 *
 * The local source is opened only momentarily (probe, then each action
 * re-opens), so nothing is held across the dialog's lifetime and a dismissed
 * dialog leaks nothing.
 */

import type { AuthClient } from '@epicenter/auth';
import { toastOnError } from '@epicenter/ui/sonner';
import { attachIndexedDb, attachLocalStorage } from '@epicenter/workspace';
import {
	defineErrors,
	extractErrorMessage,
	type InferErrors,
} from 'wellcrafted/error';
import { tryAsync } from 'wellcrafted/result';
import * as Y from 'yjs';

/** Row type of a migratable table, inferred from its `scan()` shape. */
type TableRows<T> = T extends { scan(): { rows: Array<infer R> } } ? R : never;

/** Migratable table handle, including any per-row child-doc guid derivers. */
type MigratableTable = {
	scan(): { rows: Array<{ id: string }> };
	docs: Record<string, { guid(rowId: string): string }>;
};

/** Owner-scoped storage coordinates for the child-doc merge. */
type OwnerScope = Parameters<typeof attachLocalStorage>[1];

/**
 * Delete one bare (unowned) local IndexedDB database by doc guid. Bare docs
 * name their database after the guid itself (`attachIndexedDb` default), so
 * the guid is the handle. The throwaway doc is destroyed before the delete so
 * the provider's connection never races the deletion.
 */
async function clearBareDoc(guid: string): Promise<void> {
	const doc = new Y.Doc({ guid });
	const idb = attachIndexedDb(doc);
	doc.destroy();
	await idb.whenDisposed;
	await idb.clearLocal();
}

/**
 * Merge one bare child doc's content into its owner-scoped storage.
 *
 * Reads the bare doc's full Yjs state, then applies it onto the owner-scoped
 * doc (both keyed by the same guid; only the storage partition differs). CRDT
 * merge is commutative and idempotent, so a retry is always safe. Local
 * storage only, no relay connection: the next time the doc opens, the normal
 * signed-in boot path connects it to the relay and syncs the merged content
 * out. The bare copy is NOT deleted here; deletion happens only after the
 * whole Add succeeds.
 */
async function mergeBareDocIntoOwner(
	guid: string,
	scope: OwnerScope,
): Promise<void> {
	const bareDoc = new Y.Doc({ guid, gc: true });
	const bareIdb = attachIndexedDb(bareDoc);
	await bareIdb.whenLoaded;
	const update = Y.encodeStateAsUpdate(bareDoc);
	bareDoc.destroy();
	await bareIdb.whenDisposed;
	// An empty Yjs update is 2 bytes (no client blocks). Skip the round trip
	// for a child doc that was never opened locally.
	if (update.byteLength <= 2) return;

	const ownerDoc = new Y.Doc({ guid, gc: true });
	const ownerIdb = attachLocalStorage(ownerDoc, scope);
	await ownerIdb.whenLoaded;
	Y.applyUpdate(ownerDoc, update);
	ownerDoc.destroy();
	await ownerIdb.whenDisposed;
}

/** Per-table row counts measured from the local source at probe time. */
export type MigrationCounts = Record<string, number>;

/** The surface `SignInMigrationDialog` binds to. */
export type SignInMigrationState = {
	open: boolean;
	/** Human phrase for what is staged locally (the app's `describe`). */
	readonly summary: string;
	/** Optional extra dialog line (the app's `note`), e.g. where audio files live. */
	readonly note: string | undefined;
	readonly phase: 'idle' | 'adding' | 'deleting';
	readonly isBusy: boolean;
	check(): Promise<void>;
	addToAccount(): Promise<void>;
	deleteFromDevice(): Promise<void>;
	keepForNow(): void;
};

/** Upsert every valid row from one table into another; idempotent by id. */
function copyTable<TRow extends { id: string }>(
	from: { scan(): { rows: TRow[] } },
	to: { set(row: TRow): { error: unknown } },
): void {
	for (const row of from.scan().rows) {
		const { error } = to.set(row);
		if (error) throw error;
	}
}

/** Child-doc guids for every staged row, derived from the source schema. */
function deriveChildGuids<TTables extends Record<string, MigratableTable>>(
	tables: TTables,
): string[] {
	return Object.values(tables).flatMap((table) =>
		Object.values(table.docs).flatMap((field) =>
			table.scan().rows.map((row) => field.guid(row.id)),
		),
	);
}

/**
 * Build the flag-free sign-in migration state for one app.
 *
 * The app supplies the two doc handles and the words; the copy mechanics,
 * probe, and dialog phases are shared:
 *
 * - `openLocalSource()` opens the app's BARE doc (plain `attachIndexedDb`
 *   under the doc guid) as a throwaway second instance. It never collides
 *   with the active owner-partitioned doc, whose storage key is owner-scoped.
 * - `target` is the live signed-in workspace singleton.
 *
 * Every table on the source is copied; a source table missing from the
 * target throws loudly rather than dropping data silently (unreachable when
 * both sides come from the same app factory, which is the contract).
 *
 * Per-row child docs are derived from the source tables' `.docs` namespace.
 * To exclude a table and its child docs from migration, leave the table out
 * of `openLocalSource()`'s returned subset.
 */
export function createSignInMigration<
	TTables extends Record<string, MigratableTable>,
>({
	auth,
	openLocalSource,
	target,
	describe,
	note,
	errorNoun = 'local data',
}: {
	/** The app's auth client; only the boot status gates the probe. */
	auth: AuthClient;
	/** Open a throwaway handle to the signed-out plaintext local doc. */
	openLocalSource: () => {
		tables: TTables;
		whenLoaded: Promise<unknown>;
		clearLocal(): Promise<void>;
		dispose(): void;
	};
	/** The live owner-doc workspace singleton the rows migrate into. */
	target: {
		whenReady: Promise<unknown>;
		ydoc: { transact(fn: () => void): void };
		tables: {
			[K in keyof TTables]: {
				set(row: TableRows<TTables[K]>): { error: unknown };
			};
		};
	};
	/** Human phrase for what is staged locally, from per-table counts. */
	describe: (counts: MigrationCounts) => string;
	/** Optional extra dialog line, from per-table counts. */
	note?: (counts: MigrationCounts) => string | undefined;
	/** Noun for the error toasts, e.g. "recordings". */
	errorNoun?: string;
}): SignInMigrationState {
	const MigrationError = defineErrors({
		AddFailed: ({ cause }: { cause: unknown }) => ({
			message: `Could not add your ${errorNoun} to this account: ${extractErrorMessage(cause)}`,
			cause,
		}),
		DeleteFailed: ({ cause }: { cause: unknown }) => ({
			message: `Could not remove the local ${errorNoun}: ${extractErrorMessage(cause)}`,
			cause,
		}),
		CleanupFailed: ({ cause }: { cause: unknown }) => ({
			message: `Everything is in your account, but removing the leftover local copies failed: ${extractErrorMessage(cause)}`,
			cause,
		}),
	});
	type MigrationError = InferErrors<typeof MigrationError>;

	/**
	 * Copy the whole local doc into the owner doc in one transaction (one
	 * observer fire, one relay batch), then delete the plaintext local copy.
	 * Yjs does not roll back a `transact()` callback on throw, so a mid-loop
	 * failure can leave partial rows already committed to the owner doc; the
	 * safety net is that `copyTable` is idempotent by id, not that the
	 * transaction is atomic. Either way `clearLocal` only runs after the whole
	 * copy resolves without throwing, so a failure leaves the local copy
	 * intact and the next attempt re-runs safely over whatever partial state
	 * exists.
	 */
	async function addLocalToOwner(
		source: ReturnType<typeof openLocalSource>,
	): Promise<void> {
		await target.whenReady;
		target.ydoc.transact(() => {
			for (const name of Object.keys(source.tables)) {
				const to = target.tables[name];
				if (!to) {
					throw new Error(
						`[sign-in-migration] target workspace has no table "${name}"`,
					);
				}
				copyTable(
					source.tables[name] as { scan(): { rows: { id: string }[] } },
					to,
				);
			}
		});
		await source.clearLocal();
	}

	/** Owner-scoped storage coordinates; unreachable signed out (the dialog only opens on a signed-in boot). */
	function ownerScope(): OwnerScope {
		const state = auth.state;
		if (state.status === 'signed-out') {
			throw new Error('[sign-in-migration] owner scope read while signed out.');
		}
		return { server: new URL(auth.baseURL).host, ownerId: state.ownerId };
	}

	/** Child-doc guids for every staged row, via a throwaway local source. */
	async function readChildGuids(): Promise<string[]> {
		const source = openLocalSource();
		try {
			await source.whenLoaded;
			return deriveChildGuids(source.tables);
		} finally {
			source.dispose();
		}
	}

	let open = $state(false);
	let summary = $state('');
	let noteText = $state<string | undefined>(undefined);
	let phase = $state<'idle' | 'adding' | 'deleting'>('idle');
	let hasChecked = false;

	return {
		get open() {
			return open;
		},
		set open(value: boolean) {
			// Ignore Escape/outside-click while a copy or delete is in flight; the
			// buttons are already disabled, so the dialog's own close path is the
			// one spot this guard would otherwise miss.
			if (phase !== 'idle') return;
			open = value;
		},
		get summary() {
			return summary;
		},
		get note() {
			return noteText;
		},
		get phase() {
			return phase;
		},
		get isBusy() {
			return phase !== 'idle';
		},

		/**
		 * Probe once per boot. When signed in, open the local doc, count every
		 * table `addLocalToOwner` will copy, and dispose it. Any non-empty table
		 * opens the dialog. No flag: the presence of local rows is the state, so
		 * the prompt returns next signed-in boot until resolved.
		 *
		 * Gates on every table, not one headline table: a signed-out user can
		 * build rows in a secondary table without ever touching the primary one,
		 * and the "Add" path copies all of them. Probing one table alone would
		 * strand the rest in the bare local doc, invisible under the partitioned
		 * signed-in doc, which is the exact loss this migration prevents.
		 */
		async check(): Promise<void> {
			if (hasChecked) return;
			hasChecked = true;
			if (auth.state.status === 'signed-out') return;

			const source = openLocalSource();
			const counts: MigrationCounts = {};
			try {
				await source.whenLoaded;
				for (const [name, table] of Object.entries(source.tables)) {
					counts[name] = table.scan().rows.length;
				}
			} finally {
				source.dispose();
			}
			const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
			if (total === 0) return;
			summary = describe(counts);
			noteText = note?.(counts);
			open = true;
		},

		/**
		 * Copy local data into the owner doc, then delete the plaintext local
		 * copy. With child docs: merge child content into owner storage FIRST
		 * (a failure or crash there leaves the root rows intact, so the dialog
		 * re-prompts and the idempotent merge re-runs), then rows + root clear,
		 * then best-effort deletion of the bare child copies (everything is
		 * already safe in owner storage, so a failure leaves only removable
		 * residue).
		 */
		async addToAccount(): Promise<void> {
			if (phase !== 'idle') return;
			phase = 'adding';

			let childGuids: string[] = [];
			const { error: childError } = await tryAsync({
				try: async () => {
					childGuids = await readChildGuids();
					if (childGuids.length > 0) {
						const scope = ownerScope();
						for (const guid of childGuids) {
							await mergeBareDocIntoOwner(guid, scope);
						}
					}
				},
				catch: (cause) => MigrationError.AddFailed({ cause }),
			});
			if (childError) {
				phase = 'idle';
				toastOnError(childError, childError.message);
				return;
			}

			const { error } = await tryAsync({
				try: async () => {
					const source = openLocalSource();
					try {
						await source.whenLoaded;
						await addLocalToOwner(source);
					} finally {
						source.dispose();
					}
				},
				catch: (cause) => MigrationError.AddFailed({ cause }),
			});
			phase = 'idle';
			if (error) {
				// Local copy is untouched on failure; the dialog stays open to retry
				// (already-merged child content is harmless, the merge is idempotent).
				toastOnError(error, error.message);
				return;
			}
			open = false;

			if (childGuids.length > 0) {
				const { error: cleanupError } = await tryAsync({
					try: async () => {
						for (const guid of childGuids) {
							await clearBareDoc(guid);
						}
					},
					catch: (cause) => MigrationError.CleanupFailed({ cause }),
				});
				if (cleanupError) toastOnError(cleanupError, cleanupError.message);
			}
		},

		/**
		 * Delete the plaintext local copy without copying it into the account.
		 * Bare child docs are cleared FIRST: a crash in between leaves the root
		 * rows intact, so the dialog re-prompts and the deletion converges.
		 */
		async deleteFromDevice(): Promise<void> {
			if (phase !== 'idle') return;
			phase = 'deleting';
			const { error } = await tryAsync({
				try: async () => {
					const guids = await readChildGuids();
					for (const guid of guids) {
						await clearBareDoc(guid);
					}
					const source = openLocalSource();
					try {
						await source.whenLoaded;
						await source.clearLocal();
					} finally {
						source.dispose();
					}
				},
				catch: (cause) => MigrationError.DeleteFailed({ cause }),
			});
			phase = 'idle';
			if (error) {
				toastOnError(error, error.message);
				return;
			}
			open = false;
		},

		/** Defer: close the dialog. The next signed-in boot re-probes and nags. */
		keepForNow(): void {
			if (phase !== 'idle') return;
			open = false;
		},
	};
}
