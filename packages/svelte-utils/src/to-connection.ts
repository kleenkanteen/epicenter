import type { SyncAuthClient } from '@epicenter/auth';
import type { ConnectionConfig, NodeId } from '@epicenter/workspace';

/**
 * Project the boot-time auth snapshot into a workspace connection, the one
 * argument `model.connect()` takes (ADR-0088/ADR-0094):
 *
 * ```ts
 * return myAppWorkspace.connect(toConnection(auth, nodeId));
 * ```
 *
 * Signed out projects to `null` (the bare local-first wiring); any
 * identity-bearing state (signed in, reauth-required) projects to the owner's
 * connection coordinates. `server`/`baseURL` are constant across auth states
 * (one API per client). This reads `auth.state` ONCE: identity changes never
 * swap the connection in place, `reloadOnOwnerChange` reloads so the next
 * boot re-projects.
 */
export function toConnection(
	auth: SyncAuthClient,
	nodeId: NodeId,
): ConnectionConfig | null {
	const state = auth.state;
	if (state.status === 'signed-out') return null;
	const baseURL = auth.baseURL;
	return {
		server: new URL(baseURL).host,
		baseURL,
		ownerId: state.ownerId,
		nodeId,
		openWebSocket: auth.openWebSocket,
		onReconnectSignal: auth.onStateChange,
	};
}
