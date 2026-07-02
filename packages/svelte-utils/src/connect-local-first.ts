import type { SyncAuthClient } from '@epicenter/auth';
import {
	type ActionRegistry,
	attachBroadcastChannel,
	attachIndexedDb,
	type Collaboration,
	connectDoc,
	type NodeId,
} from '@epicenter/workspace';
import type { SignedIn } from './session.svelte.js';

/**
 * The Y.Doc shape `connectDoc` accepts, derived so this package carries no
 * direct yjs dependency.
 */
type WorkspaceDoc = Parameters<typeof connectDoc>[0];

/**
 * Project a signed-in auth snapshot into the `SignedIn` payload workspace
 * connectors consume (`model.connect({ ...projectSignedIn(auth), nodeId })`).
 *
 * `server`/`baseURL` are constant across auth states (one API per client).
 * This is the same projection `createSession` does internally; exposed as a
 * plain function on purpose, because `createSession`'s live reactive swap
 * fights reload-on-auth. Throws while signed out: the boot branch checks
 * `auth.state.status` first.
 */
export function projectSignedIn(auth: SyncAuthClient): SignedIn {
	const state = auth.state;
	if (state.status === 'signed-out') {
		throw new Error('[auth] projectSignedIn() called while signed-out.');
	}
	const baseURL = auth.baseURL;
	return {
		server: new URL(baseURL).host,
		baseURL,
		ownerId: state.ownerId,
		openWebSocket: auth.openWebSocket,
		onReconnectSignal: auth.onStateChange,
	};
}

/**
 * Wire a workspace doc for this boot: the one composition shape every
 * Epicenter workspace app uses (ADR-0088, sign-in is an enhancement, never a
 * door).
 *
 * Reads the persisted `auth.state` ONCE, synchronously, at call time:
 *
 * - signed-out: plain IndexedDB persistence under the doc's own guid, no
 *   relay. `collaboration` is `undefined`.
 * - signed-in / reauth-required: owner-scoped local storage plus relay sync
 *   via `connectDoc`.
 *
 * Identity changes are never an in-place swap: pair this with
 * {@link reloadOnOwnerChange}, which reloads the page so the next boot
 * re-runs this selection. Construction is synchronous; data still loads
 * async behind `whenReady`.
 *
 * The cross-tab BroadcastChannel is scoped to the branch: signed-out docs get
 * the bare guid channel, signed-in docs get only the owner-keyed channel that
 * `connectDoc` attaches internally. A signed-in doc on the bare channel would
 * let a signed-out tab (a DIFFERENT doc with the same guid) cross-pollinate
 * updates into the owner doc, bypassing the sign-in migration, and would let
 * two signed-in owners on one profile exchange plaintext.
 */
export function connectLocalFirst({
	auth,
	ydoc,
	nodeId,
	actions,
}: {
	/** The app's reactive auth client; only its boot snapshot is read here. */
	auth: SyncAuthClient;
	/** The workspace root doc to wire (its `guid` keys storage and the room). */
	ydoc: WorkspaceDoc;
	/** Stable per-node id for relay room addressing (`createNodeId`). */
	nodeId: NodeId;
	/** The root doc's action registry, when it has one. */
	actions?: ActionRegistry;
}): {
	/** Resolves when local persistence has hydrated the doc. */
	whenReady: Promise<unknown>;
	/** Relay sync handle; `undefined` while signed out. */
	collaboration: Collaboration | undefined;
} {
	const state = auth.state;

	if (state.status === 'signed-out') {
		attachBroadcastChannel(ydoc);
		const idb = attachIndexedDb(ydoc);
		return { whenReady: idb.whenLoaded, collaboration: undefined };
	}

	const { idb, collaboration } = connectDoc(
		ydoc,
		{ ...projectSignedIn(auth), nodeId },
		{ actions },
	);
	return { whenReady: idb.whenLoaded, collaboration };
}
