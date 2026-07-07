/**
 * Daemon-side runtime types.
 *
 * `DaemonRuntime` is the contract every opened mount returns: async dispose
 * plus the local action registry available inside the watcher process.
 * Collaborative mounts may also expose a hosted `Collaboration` for identity,
 * sync, and peer presence.
 *
 * `StartedMount` is the lifecycle-owning mount shape opened from a configured
 * mount factory.
 */

import type { Collaboration } from '../document/open-collaboration.js';
import type { ActionRegistry } from '../shared/actions.js';
import type { MaybePromise } from '../shared/types.js';

/**
 * Fields the daemon looks at on each started runtime.
 */
export type DaemonRuntime = {
	/** Called by the daemon at exit. */
	[Symbol.asyncDispose](): MaybePromise<void>;

	/** The action registry available inside this runtime. */
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
