/**
 * Mount-daemon persistence + sync infrastructure for a single workspace doc.
 *
 * `attachMountInfrastructure(ydoc, ctx, opts)` is the recipe every
 * session-backed mount needs: pin the deterministic Y.Doc `clientID`, persist
 * the update log to disk under `yjsPath(epicenterRoot, guid)`, join the cloud
 * room at `roomWsUrl({ baseURL, guid, nodeId })`, and
 * own the ordered async dispose (destroy first so writes flush before sockets
 * close, then await every `whenDisposed` barrier: collaboration, log, and any
 * registered materializers).
 *
 * Identity comes from `ctx`: the durable per-install `ctx.nodeId` (resolved
 * once at root open and persisted under `.epicenter/`) is the relay's routing id
 * and the seed for the Y.Doc `clientID`. The owner and transport refs come from
 * `ctx.session`. The mount name is a label only, never an identity seed. The
 * caller supplies what is genuinely its own: the sync `baseURL`, catalog-agent
 * identity, and any materializers.
 *
 * `clientID` is pinned before any local edit; materializers attached earlier
 * only project the doc outward and never write to it, so this ordering is safe.
 *
 * Returns the optional-peer `collaboration`, the side-effectful `yjsLog` handle,
 * and an `[Symbol.asyncDispose]` that encodes the destroy order. Callers usually
 * spread the result into their `DaemonRuntime` and compose materializers around
 * the same ydoc.
 */

import type * as Y from 'yjs';

import { attachYjsLog } from '../document/attach-yjs-log.js';
import { openCollaboration } from '../document/open-collaboration.js';
import { roomWsUrl } from '../document/transport.js';
import { yjsPath } from '../document/workspace-paths.js';
import { hashYDocClientId } from '../shared/client-id.js';
import type { Drainable } from '../shared/types.js';
import type { SessionMountContext } from './define-mount.js';

export type AttachMountInfrastructureOptions = {
	/** Base URL of the sync server (the Epicenter cloud, or a self-hosted hub). */
	baseURL: string;
	/**
	 * The catalog agent this daemon answers as (ADR-0025), published in
	 * presence so peers can decorate it as live. Omit for a mount that hosts
	 * sync without answering as a named agent.
	 */
	agentId?: string;
	/**
	 * Materializer attachments composed around the same ydoc. Their teardown
	 * drains are awaited alongside collaboration and log teardown, so a daemon
	 * shutdown cannot drop projection writes mid-flight. Each drain is bounded
	 * by the materializer's own `disposeTimeoutMs`.
	 */
	materializers?: ReadonlyArray<Drainable>;
};

export function attachMountInfrastructure(
	ydoc: Y.Doc,
	ctx: SessionMountContext,
	{ baseURL, agentId, materializers = [] }: AttachMountInfrastructureOptions,
) {
	ydoc.clientID = hashYDocClientId(ctx.nodeId);

	const yjsLog = attachYjsLog(ydoc, {
		filePath: yjsPath(ctx.epicenterRoot, ydoc.guid),
	});

	const collaboration = openCollaboration(ydoc, {
		url: roomWsUrl({
			baseURL,
			guid: ydoc.guid,
			nodeId: ctx.nodeId,
		}),
		openWebSocket: ctx.session.openWebSocket,
		onReconnectSignal: ctx.session.onReconnectSignal,
		agentId,
	});

	return {
		/** Durable Y.Doc update log handle. */
		yjsLog,
		/** Cloud sync and presence handle for this mount. */
		collaboration,
		/**
		 * Destroy the Y.Doc, then await collaboration, log, and materializer
		 * teardown (each materializer drains its pending projection writes).
		 */
		async [Symbol.asyncDispose]() {
			ydoc.destroy();
			await Promise.all([
				collaboration.whenDisposed,
				yjsLog.whenDisposed,
				...materializers.map((materializer) => materializer.whenDisposed),
			]);
		},
	};
}
