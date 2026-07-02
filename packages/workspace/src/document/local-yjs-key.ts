/**
 * Browser-local storage key for principal-scoped Yjs persistence.
 *
 * Mirrors the server's `doName(ownerId, ...)` shape so the same
 * `(server, ownerId, doc)` tuple resolves to the same partition namespace
 * locally and remotely. Two signed-in accounts on the same browser profile, or
 * two self-hosted instances signed into the same machine, never collide on
 * IndexedDB names or BroadcastChannel names.
 *
 * Key layout (uniform across personal and instance deployments):
 *
 *   epicenter/<server>/principals/<ownerId>/<ydoc.guid>
 *
 * The server segment is the API origin host (e.g. `api.epicenter.so`). In
 * per-user cloud, `ownerId` equals the user id; on an instance it is the
 * literal `'instance'` for every operator, so the server segment is what keeps
 * two instances on one machine from colliding.
 */

import type { OwnerId } from '@epicenter/identity';

const APP = 'epicenter';

/**
 * Prefix for every key built for this `(server, ownerId)` pair.
 *
 * Wipe paths use this to enumerate every database owned by the pair.
 */
export function getOwnedYjsPrefix(server: string, ownerId: OwnerId): string {
	return `${APP}/${server}/principals/${ownerId}/`;
}

/**
 * Browser-local persistence and BroadcastChannel key for a Y.Doc.
 *
 * The `server` and `ownerId` arguments scope local data when one browser
 * profile uses multiple accounts or instances. This key is a local runtime
 * name only; it does not change `ydoc.guid`, sync room names, or child document
 * GUIDs.
 */
export function createOwnedYjsKey(
	server: string,
	ownerId: OwnerId,
	ydocGuid: string,
): string {
	return `${getOwnedYjsPrefix(server, ownerId)}${ydocGuid}`;
}
