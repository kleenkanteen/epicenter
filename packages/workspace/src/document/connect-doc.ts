/**
 * `connectDoc`: wire one Y.Doc to local storage + cloud sync.
 *
 * This is the shared primitive behind every doc a workspace owns. A workspace is
 * a tree of Y.Docs that all speak to the same relay under one owner: the root
 * doc (tables + KV, carrying the workspace's action registry) and every body
 * child doc (an `attach*` layout, no actions). Both want the exact same wiring,
 * which every app's `browser.ts` had hand-copied as a local `wire` helper.
 *
 * Returns the local persistence and collaboration handles. Sync is opened for
 * its side effect (the relay streams updates in, every signed-in node watches
 * live); teardown cascades from `ydoc.destroy()`.
 *
 * @module
 */

import type { PrincipalId } from '@epicenter/identity';
import type * as Y from 'yjs';
import type { ActionRegistry } from '../shared/actions.js';
import { attachLocalStorage } from './attach-local-storage.js';
import type { NodeId } from './node-id.js';
import {
	type OnReconnectSignal,
	type OpenWebSocketFn,
	openCollaboration,
} from './open-collaboration.js';
import { roomWsUrl } from './transport.js';

/**
 * Everything a workspace's docs need to reach local storage and the relay,
 * shared by the root doc and every body. Structurally a superset of the auth
 * `SignedIn` payload plus the per-client `nodeId`; typed against
 * workspace-native types so the runtime never imports the auth/Svelte layer.
 *
 * Pass `{ ...signedIn, nodeId }` at the call site.
 */
export type ConnectionConfig = {
	/**
	 * Full API origin URL (e.g. `https://api.epicenter.so`). The scheme upgrades
	 * to `wss://` for the room socket, and the URL's host partitions local
	 * storage (see `attachLocalStorage`), so sync target and storage scope can
	 * never disagree.
	 */
	baseURL: string;
	ownerId: PrincipalId;
	/** Bearer-attached WebSocket opener (`auth.openWebSocket`). */
	openWebSocket: OpenWebSocketFn;
	/** Auth state-change publication; sync reconnects after token refreshes. */
	onReconnectSignal: OnReconnectSignal;
	nodeId: NodeId;
};

/**
 * Wire `ydoc` to local IndexedDB persistence and the relay room for its guid.
 *
 * @param ydoc    - the doc to connect (its `guid` selects the room).
 * @param config  - connection coordinates, pre-bound once per workspace.
 * @param actions - the doc's action registry. Defaults to `{}`, which is what
 *                  every body child doc wants; the root passes its own registry.
 * @returns `{ idb, collaboration }` - local persistence + sync handles, both
 *          disposed when `ydoc.destroy()` fires.
 */
export function connectDoc<TActions extends ActionRegistry = ActionRegistry>(
	ydoc: Y.Doc,
	config: ConnectionConfig,
	{ actions = {} as TActions }: { actions?: TActions } = {},
) {
	const idb = attachLocalStorage(ydoc, {
		server: new URL(config.baseURL).host,
		ownerId: config.ownerId,
	});
	const collaboration = openCollaboration(ydoc, {
		url: roomWsUrl({
			baseURL: config.baseURL,
			guid: ydoc.guid,
			nodeId: config.nodeId,
		}),
		openWebSocket: config.openWebSocket,
		onReconnectSignal: config.onReconnectSignal,
		waitFor: idb.whenLoaded,
		actions,
	});
	return { idb, collaboration };
}
