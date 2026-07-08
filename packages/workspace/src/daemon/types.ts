/**
 * Daemon-side runtime types.
 *
 * `DaemonRuntime` is the contract every opened mount returns: async dispose,
 * plus an optional hosted `Collaboration` for identity, sync, and peer
 * presence. The watcher is not a callable action server (ADR-0112), so the
 * runtime carries no action registry.
 *
 * `StartedMount` is the lifecycle-owning mount shape opened from a configured
 * mount factory.
 */

import type { Collaboration } from '../document/open-collaboration.js';
import type { MaybePromise } from '../shared/types.js';

/**
 * Fields the daemon looks at on each started runtime.
 */
export type DaemonRuntime = {
	/** Called by the daemon at exit. */
	[Symbol.asyncDispose](): MaybePromise<void>;

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
