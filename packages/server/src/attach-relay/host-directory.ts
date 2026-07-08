/**
 * The attach host directory entry (ADR-0115 wave 5): the whole of what a
 * signed-in client may learn about an attachable Super Chat host before it
 * attaches. A client discovers a host by `hostId`, a human `label`, and a
 * liveness `status`, and by nothing else. The directory names what to dial, not
 * what the host can do.
 *
 * ## Why this is a closed schema
 *
 * With one consumer, an attachable host is a Super Chat host by definition
 * (ADR-0115 clause 3), so there is no capability field to carry: adding one
 * would be `exposedRoutes` in a closed-enum costume. This entry is therefore a
 * `.onUndeclaredKey('reject')` schema, so any route-, capability-, action-, or
 * tool-shaped field (`capability`, `route`, `exposedRoutes`, `action`, `tools`,
 * `methods`, `method`, `path`, `name`, `topic`, `toolName`, a `tools/list` or
 * `tools/call` verb) fails to parse. That is PR #2277's presence-schema guard,
 * re-homed onto the AttachRelay directory: the directory cannot grow into a
 * capability registry, because an undeclared key has nowhere to land.
 *
 * ## Where this sits
 *
 * This is the account-and-device-layer directory ADR-0115 clause 3 puts above
 * the relay, beside the device grants (`device-grants.ts`), never inside the
 * relay coordinator (`core.ts`), which stays byte-, frame-, key-, and now
 * directory-blind: it forwards opaque bytes addressed by `principalId`,
 * `hostId`, `deviceId`, `attachId`, and never learns a directory exists. Wave 5
 * proves only the entry shape; no runtime mount consumes it yet, so this is a
 * schema plus its guard tests, not a live product directory.
 *
 * ## Deliberately not built here (smallest model, ADR-0115 wave 5)
 *
 * - `status` is `online | offline` only. "Online but unreachable" is a distinct
 *   state wave 6 earns when the desktop can be asleep while its synced history
 *   still reads; folding it in now would be a status the proof cannot yet
 *   exercise.
 * - There is no directory store, route, or presence feed: a host does not
 *   publish an entry anywhere yet. The wire and mount for discovery are a later
 *   refinement; this wave pins the shape the guard protects.
 */

import { type } from 'arktype';

/**
 * A host's liveness in the directory. `online` means the host endpoint is
 * currently registered and reachable for a fresh attach; `offline` means it is
 * not. "Online but unreachable" (synced history reads, but a new local-source
 * question cannot) is deferred to ADR-0115 wave 6, so this enum stays two-valued
 * until the proof that distinguishes it lands.
 */
export const AttachHostStatus = type("'online' | 'offline'");
export type AttachHostStatus = typeof AttachHostStatus.infer;

/**
 * One attachable Super Chat host, as a client discovers it. Exactly `hostId`,
 * `label`, and `status`: the id to dial, the human name to show, and whether it
 * is live. The schema rejects undeclared keys, so it can never describe what the
 * host exposes (ADR-0115 clause 3); that refusal is the whole point of the wave.
 */
export const AttachHostDirectoryEntry = type({
	/** The endpoint id a client dials to attach; never a route name. */
	hostId: 'string > 0',
	/** The operator's human label for this host ("Braden's Mac"). */
	label: 'string',
	/** Whether the host is live for a fresh attach. */
	status: AttachHostStatus,
}).onUndeclaredKey('reject');
export type AttachHostDirectoryEntry = typeof AttachHostDirectoryEntry.infer;
