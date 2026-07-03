/// <reference lib="dom" />

import { createLogger, type Logger } from 'wellcrafted/logger';
import { clearDocument, IndexeddbPersistence } from 'y-indexeddb';
import type * as Y from 'yjs';

/**
 * Re-boot the page when the browser evicts our IndexedDB connection because
 * another context deleted the database out from under it. The local store is
 * gone, so continuing on an in-memory-only doc would silently diverge and never
 * persist again; a reload re-opens whatever store the current auth state selects
 * (ADR-0088), the same lifecycle-discontinuity response `reloadOnPrincipalChange`
 * uses. Guarded so a non-browser import (tests, node) is a no-op.
 */
function reloadOnEviction(): void {
	if (typeof window !== 'undefined') window.location.reload();
}

export function attachIndexedDb(
	ydoc: Y.Doc,
	options: {
		databaseName?: string;
		/**
		 * Called once if the underlying database is deleted by ANOTHER connection
		 * (a second tab's `wipe()`, any cross-context `clearDocument`) while this
		 * doc is live. Defaults to a page reload; injected in tests to observe the
		 * eviction without navigating.
		 */
		onEvicted?: () => void;
		log?: Logger;
	} = {},
) {
	const databaseName = options.databaseName ?? ydoc.guid;
	const onEvicted = options.onEvicted ?? reloadOnEviction;
	const log = options.log ?? createLogger('workspace/attach-indexed-db');
	// Corrupt-store healing lives in `patches/y-indexeddb@9.0.12.patch`, not here.
	// The upstream loader applies persisted updates with no `.catch`, so a single
	// undecodable update both wedges `whenSynced` forever and floats an uncatchable
	// decode error. The patch wraps the per-update apply in a `try/catch` that skips
	// the bad bytes (server resync supplies them) and still emits `'synced'`.
	// `attach-local-storage-corrupt-load.test.ts` is the regression gate: it goes
	// red the day the patch stops applying.
	const idb = new IndexeddbPersistence(databaseName, ydoc);
	// `IndexeddbPersistence`'s constructor binds `doc.on('destroy', this.destroy)`
	// eagerly, and its `destroy()` has no top-level idempotency guard: two calls
	// produce two independent `_db.then(db => db.close())` promises that resolve
	// at different moments. Strip the upstream binding so our wrapper is the
	// sole gateway. Cascade-triggered teardown resolves `whenDisposed` only
	// after the actual close completes, so wipe() can await an honest barrier.
	ydoc.off('destroy', idb.destroy);
	const { promise: whenDisposed, resolve: resolveDisposed } =
		Promise.withResolvers<void>();
	const whenLoaded: Promise<unknown> = idb.whenSynced;

	// One teardown path, run at most once, whether teardown is triggered by our
	// own `ydoc.destroy()` (the cascade below), our own `clearLocal()`, or the
	// browser evicting the connection (the eviction guard below). `idb.destroy()`
	// closes the db AND unsubscribes y-indexeddb's `update` listener, so once it
	// runs no later Yjs write can reach the connection.
	//
	// `torndown` is a `let` flag, not the `once()` helper, on purpose: the
	// eviction guard READS it (via `selfDeleting`/`torndown`) to decide whether we
	// are already going down and so must NOT fire `onEvicted`. That makes it a
	// liveness flag, not a pure once-guard (`once` explicitly does not replace
	// such a boolean). `selfDeleting` records that WE deleted this database (our
	// own `clearLocal()`), so the `versionchange` it triggers on our still-open
	// connection tears down cleanly rather than re-booting; only a delete from
	// ANOTHER connection re-boots.
	let torndown = false;
	let selfDeleting = false;
	async function teardown(): Promise<void> {
		if (torndown) return;
		torndown = true;
		try {
			await idb.destroy();
		} finally {
			resolveDisposed();
		}
	}

	const clearLocal = (): Promise<void> => {
		selfDeleting = true;
		return clearDocument(databaseName);
	};

	ydoc.once('destroy', () => void teardown());

	// Eviction guard. `lib0`'s `openDB` installs `db.onversionchange = () =>
	// db.close()`, which fires when ANOTHER connection deletes this database (a
	// second tab's "Forget device" wipe, or any cross-context `clearDocument`).
	// That raw close leaves `IndexeddbPersistence`'s `update` listener subscribed
	// and `this.db` pointing at the closed database, so the very next Yjs write
	// calls `transact()` on a dead handle and throws "Can't start a transaction on
	// a closed database" straight into the caller (the chat send, the model
	// write). Take the handler over: teardown always runs (it unsubscribes that
	// listener so writes stop crashing AND closes the connection so the pending
	// delete can proceed); we re-boot via `onEvicted` only when ANOTHER connection
	// deleted the store out from under us, not for our own `clearLocal()` or
	// `ydoc.destroy()`. Registered after `whenSynced` so it replaces lib0's
	// handler rather than racing it.
	void idb.whenSynced.then(() => {
		const db = idb.db;
		if (db === null) return;
		db.onversionchange = () => {
			const evictedByOther = !selfDeleting && !torndown;
			void teardown();
			if (evictedByOther) {
				log.info(
					`Local IndexedDB "${databaseName}" was deleted by another connection; re-booting.`,
				);
				onEvicted();
			}
		};
	});

	return {
		/**
		 * Resolves when local IndexedDB state has loaded into the Y.Doc: "your
		 * draft is in memory, edits are safe." Not CRDT convergence despite
		 * `y-indexeddb`'s upstream `whenSynced` name. Pair with `sync.whenConnected`
		 * when you also need remote state. The patched loader skips undecodable
		 * updates rather than hanging, so this never wedges on a corrupt store.
		 */
		whenLoaded,
		/** Delete the local IndexedDB document without destroying the Y.Doc. */
		clearLocal,
		/**
		 * Resolves after `ydoc.destroy()` fires the cascade and the IndexedDB
		 * connection has actually closed, or after an external eviction tore it
		 * down. Bundle wipe methods await this before deleting persisted data.
		 */
		whenDisposed,
	};
}

export type IndexedDbAttachment = ReturnType<typeof attachIndexedDb>;
