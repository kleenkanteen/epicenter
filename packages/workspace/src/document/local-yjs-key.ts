/**
 * Browser-local storage key for principal-scoped Yjs persistence.
 *
 * Mirrors the server's `doName(principalId, ...)` shape so the same
 * `(server, principalId, doc)` tuple resolves to the same partition namespace
 * locally and remotely. Two signed-in accounts on the same browser profile, or
 * two self-hosted instances signed into the same machine, never collide on
 * IndexedDB names or BroadcastChannel names.
 *
 * Key layout (uniform across personal and instance deployments):
 *
 *   epicenter/<server>/principals/<principalId>/<ydoc.guid>
 *
 * The server segment is the API origin host (e.g. `api.epicenter.so`). In
 * per-user cloud, `principalId` equals the user id; on an instance it is the
 * literal `'instance'` for every operator, so the server segment is what keeps
 * two instances on one machine from colliding.
 */

import type { PrincipalId } from '@epicenter/identity';

const APP = 'epicenter';

/**
 * Prefix for every key built for this `(server, principalId)` pair.
 *
 * Wipe paths use this to enumerate every database owned by the pair.
 */
export function getPrincipalYjsPrefix(
	server: string,
	principalId: PrincipalId,
): string {
	return `${APP}/${server}/principals/${principalId}/`;
}

/**
 * Browser-local persistence and BroadcastChannel key for a Y.Doc.
 *
 * The `server` and `principalId` arguments scope local data when one browser
 * profile uses multiple accounts or instances. This key is a local runtime
 * name only; it does not change `ydoc.guid`, sync room names, or child document
 * GUIDs.
 */
export function createPrincipalYjsKey(
	server: string,
	principalId: PrincipalId,
	ydocGuid: string,
): string {
	return `${getPrincipalYjsPrefix(server, principalId)}${ydocGuid}`;
}
