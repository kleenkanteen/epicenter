/**
 * Vocabulary for the AttachRelay (ADR-0115): Epicenter forwards live Super Chat
 * bytes between two authenticated endpoints of one principal, a signed-in client
 * and a desktop Super Chat host. The relay is endpoint-addressed, never
 * route-addressed: it routes by the quadruple `principalId`, `hostId`,
 * `deviceId`, `attachId`, and by nothing else. There is no route name, no route
 * registry, no capability field. Those are the relay-floor organs deleted in
 * PR #2277, and endpoint addressing is what keeps them from having anywhere to
 * live (ADR-0115 clause 1).
 *
 * ## What the relay owns
 *
 * The relay owns the endpoint envelope and socket fan-out. It does not own Super
 * Chat command semantics, host snapshots, tool names, or local-source reach. The
 * payload is trusted transport data: hosted Cloud may observe it, but the relay
 * still stores no frames and exposes no route or capability surface.
 *
 * @see `attach-relay/core.ts` for the coordinator that consumes these types.
 */

/**
 * The minimal per-connection surface the coordinator drives, structural by
 * design so a Bun `ServerWebSocket`, a browser `WebSocket`, and a test double
 * all satisfy it without a wrapper (the same move {@link RoomSocket} makes).
 *
 * `send` carries one opaque string frame; the coordinator never inspects it
 * beyond the envelope the host wire wraps it in. `readyState` follows the
 * WebSocket spec (CONNECTING=0, OPEN=1, CLOSING=2, CLOSED=3) so the coordinator
 * can skip a send onto a socket racing closed.
 */
export type RelaySocket = {
	send(data: string): void;
	close(code: number, reason: string): void;
	readonly readyState: number;
};

/**
 * The address of one client endpoint under a host: the `deviceId` (which
 * signed-in device) and the `attachId` (which attach session on that device).
 * The `principalId` and `hostId` are implicit on a host's own wire: a host
 * registered once under them, so every frame on its wire is already scoped to
 * that host endpoint. This is the whole of the relay's addressing on the host
 * wire, and it names no route.
 */
export type ClientEndpoint = {
	deviceId: string;
	attachId: string;
};

/**
 * A frame the relay delivers to the host. Either a client endpoint's lifecycle
 * transition (it attached or detached, so the host can push it an initial
 * snapshot or drop it) or that endpoint's opaque command bytes. The relay
 * generates the lifecycle events from the socket set it already observes; it
 * never parses the `payload`. Discriminated by which of `event`/`payload` is
 * present, so the envelope stays a pair of endpoint ids plus one opaque field,
 * never a routing verb table.
 */
export type RelayToHostFrame =
	| (ClientEndpoint & { event: 'attach' | 'detach' })
	| (ClientEndpoint & { payload: string });

/**
 * A frame the host sends the relay: bytes addressed to exactly one client
 * endpoint. There is no broadcast frame: the host addresses each client endpoint
 * on its own. Fan-out to N clients is N of these, never one frame the relay
 * expands.
 */
export type HostToRelayFrame = ClientEndpoint & { payload: string };

/** Application close codes the relay uses on the client and host wires. */
export const RELAY_CLOSE = {
	/** A client attached to a `(principalId, hostId)` with no live host. */
	HOST_NOT_FOUND: 4404,
	/** The client's host endpoint dropped; its attach cannot outlive it. */
	HOST_GONE: 4410,
	/** A second host tried to register a `(principalId, hostId)` already held. */
	HOST_CONFLICT: 4409,
} as const;
