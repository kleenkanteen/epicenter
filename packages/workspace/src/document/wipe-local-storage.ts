/// <reference lib="dom" />

/**
 * `wipeLocalStorage`: delete every `(server, principalId)`-scoped IndexedDB
 * database on the current browser profile.
 *
 * Enumerates `indexedDB.databases()` and clears every entry whose name
 * starts with the durable prefix produced by {@link getPrincipalYjsPrefix} for
 * the given `(server, principalId)` pair. This is a free function with no auth
 * coupling: the caller (sign-out handler, "delete my local data" button,
 * admin migration) passes the pair explicitly.
 *
 * Belt-and-suspenders with an explicit guid list is unnecessary: every
 * principal-scoped IDB database is created under the principal prefix, and the
 * prefix scan catches all of them.
 *
 * No-ops gracefully when `indexedDB.databases()` is unavailable (older
 * browsers): nothing to enumerate means nothing to delete here.
 *
 * @module
 */

import type { PrincipalId } from '@epicenter/identity';
import { clearDocument } from 'y-indexeddb';
import { getPrincipalYjsPrefix } from './local-yjs-key.js';

/**
 * Delete every IndexedDB database owned by `(server, principalId)` on
 * this browser profile.
 *
 * @example
 * ```ts
 * await wipeLocalStorage({
 *   server: new URL(connection.baseURL).host,
 *   principalId: connection.principalId,
 * });
 * ```
 */
export async function wipeLocalStorage({
	server,
	principalId,
}: {
	server: string;
	principalId: PrincipalId;
}): Promise<void> {
	const prefix = getPrincipalYjsPrefix(server, principalId);
	if (!('databases' in indexedDB)) return;
	const databases = await indexedDB.databases().catch(() => []);
	const names = databases
		.map((db) => db.name)
		.filter(
			(name): name is string =>
				typeof name === 'string' && name.startsWith(prefix),
		);
	await Promise.all(names.map((name) => clearDocument(name)));
}

/**
 * Delete every BARE (unowned, local-first) IndexedDB database of one
 * workspace: the root doc, named by its guid, plus every child doc, whose
 * guids extend the root guid (`<guid>.<collection>.<rowId>.<field>`), so one
 * prefix scan catches the whole family. The `connect(null)` bundle's
 * `wipe()` calls this; principal-scoped databases are untouched (those belong
 * to {@link wipeLocalStorage}).
 */
export async function wipeBareStorage(rootGuid: string): Promise<void> {
	if (!('databases' in indexedDB)) return;
	const databases = await indexedDB.databases().catch(() => []);
	const names = databases
		.map((db) => db.name)
		.filter(
			(name): name is string =>
				typeof name === 'string' &&
				(name === rootGuid || name.startsWith(`${rootGuid}.`)),
		);
	await Promise.all(names.map((name) => clearDocument(name)));
}
