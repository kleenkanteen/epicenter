/**
 * The attach host directory entry (ADR-0115): the whole of what a
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
 * relay coordinator (`core.ts`), which stays byte-, frame-, key-, and
 * directory-blind: it forwards opaque bytes addressed by `principalId`,
 * `hostId`, `deviceId`, `attachId`, and never learns a directory exists. No
 * runtime mount consumes this yet, so it is a schema plus its guard tests, not a
 * live product directory.
 *
 * ## Deliberately not built here (smallest model, ADR-0115)
 *
 * - There is no directory store, route, or presence feed: a host does not
 *   publish an entry anywhere yet. The wire and mount for discovery are a later
 *   refinement; this pins the shape the guard protects. The `unreachable` status
 *   has a consumer (Super Chat's ask-gate), but the live publish/discover wire
 *   stays deferred.
 */

import { type } from 'arktype';

/**
 * A host's liveness in the directory, the whole signal a client dials on. Three
 * states, because the phone must tell "wake your desktop" from "reconnecting"
 * (ADR-0115):
 * - `online`: the host endpoint is registered and reachable for a fresh attach.
 * - `offline`: the desktop is not connected at all (asleep or shut down).
 * - `unreachable`: the host is known but its live channel is not usable right
 *   now (its relay socket dropped, or a partition), so a fresh attach cannot
 *   form even though the desktop is not definitively gone.
 *
 * Both `offline` and `unreachable` deny a new local-source question and both
 * still allow reading synced history: reading is a durable-replica read that
 * needs no live host (ADR-0055), while asking needs the live session. The two
 * are kept distinct so a client renders the right recovery, never so the relay
 * routes on them; the relay never sees this enum.
 */
export const AttachHostStatus = type("'online' | 'offline' | 'unreachable'");
export type AttachHostStatus = typeof AttachHostStatus.infer;

/**
 * One attachable Super Chat host, as a client discovers it. Exactly `hostId`,
 * `label`, and `status`: the id to dial, the human name to show, and whether it
 * is live. The schema rejects undeclared keys, so it can never describe what the
 * host exposes (ADR-0115 clause 3); that refusal is the whole point.
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
