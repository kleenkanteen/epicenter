/**
 * Daemon-side runtime types.
 *
 * `DaemonRuntime` is the contract every opened mount returns: async dispose
 * plus the local action registry the daemon serves. Collaborative mounts may
 * also expose a hosted `Collaboration` for identity, sync, and peer presence.
 *
 * `DaemonServedMount` is the narrowed mount-handler contract for the socket
 * app. `StartedMount` is the lifecycle-owning mount shape opened from a
 * configured mount factory.
 */

import type { Collaboration } from '../document/open-collaboration.js';
import type { ActionRegistry } from '../shared/actions.js';
import type { MaybePromise } from '../shared/types.js';

/**
 * One mounted runtime as served by the daemon socket app.
 *
 * Full started mounts can pass through structurally, but mount handlers do
 * not depend on lifecycle fields such as async disposal.
 */
export type DaemonServedMount = {
	mount: string;
	runtime: {
		actions: ActionRegistry;
		collaboration?: { peers: Pick<Collaboration['peers'], 'list'> };
	};
};

/**
 * Fields the daemon looks at on each started runtime.
 */
export type DaemonRuntime = {
	/** Called by the daemon at exit. */
	[Symbol.asyncDispose](): MaybePromise<void>;

	/** The action registry this daemon serves locally. */
	readonly actions: ActionRegistry;

	/**
	 * Optional hosted collaboration. Identity, sync status, and live-node
	 * presence live here when the mount participates in a collaborative Yjs
	 * workspace.
	 */
	readonly collaboration?: Collaboration;
};

/** One configured mount runtime hosted by the daemon. */
export type StartedMount = {
	mount: string;
	runtime: DaemonRuntime;
};
