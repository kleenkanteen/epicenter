/// <reference lib="dom" />

/**
 * `attachLocalStorage`: pair plaintext IndexedDB persistence with a
 * `(server, principalId)`-scoped BroadcastChannel for a Y.Doc.
 *
 * One call covers both browser-local surfaces because they are always paired
 * for an authenticated workspace doc: writes that go to IDB also need to
 * cross-tab broadcast under the same principal scope, and the database
 * name and channel name must match so two tabs of the same principal share both
 * storage and live updates.
 *
 * Names are derived via {@link createPrincipalYjsKey}. Two signed-in principals
 * on the same browser profile, or one principal signed into two different
 * self-hosted instances on the same machine, never collide on local storage or
 * BroadcastChannel.
 *
 * Returns the IDB attachment so callers can await `whenLoaded` (e.g. to gate
 * `openCollaboration({ waitFor: idb.whenLoaded })`) or `whenDisposed` during
 * wipe orchestration.
 *
 * @module
 */

import type { PrincipalId } from '@epicenter/identity';
import type * as Y from 'yjs';
import { attachBroadcastChannel } from './attach-broadcast-channel.js';
import {
	attachIndexedDb,
	type IndexedDbAttachment,
} from './attach-indexed-db.js';
import { createPrincipalYjsKey } from './local-yjs-key.js';

/**
 * Attach `(server, principalId)`-scoped plaintext IndexedDB persistence plus a
 * matching BroadcastChannel to `ydoc`.
 *
 * `server` and `principalId` are stable for the lifetime of the attachment: they
 * become the IDB database name and BroadcastChannel key prefix, so two
 * accounts on the same browser profile do not share local workspace data
 * and two self-hosted instances on the same machine do not collide either.
 * Snapshotted at attach time; session lifecycles guarantee stability by
 * disposing the workspace on sign-out and re-mounting on the next sign-in.
 *
 * @example
 * ```ts
 * const idb = attachLocalStorage(ydoc, {
 *   server: new URL(connection.baseURL).host,
 *   principalId: connection.principalId,
 * });
 * await idb.whenLoaded;
 * ```
 */
export function attachLocalStorage(
	ydoc: Y.Doc,
	options: {
		server: string;
		principalId: PrincipalId;
	},
): IndexedDbAttachment {
	const databaseName = createPrincipalYjsKey(
		options.server,
		options.principalId,
		ydoc.guid,
	);
	const idb = attachIndexedDb(ydoc, { databaseName });
	attachBroadcastChannel(ydoc, databaseName);
	return idb;
}
