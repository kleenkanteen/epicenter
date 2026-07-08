/**
 * Vocabulary for the AttachRelay (ADR-0115): Epicenter forwards sealed bytes
 * between two authenticated endpoints of one principal, a signed-in client and
 * a desktop Super Chat host. The relay is endpoint-addressed, never
 * route-addressed: it routes by the quadruple `principalId`, `hostId`,
 * `deviceId`, `attachId`, and by nothing else. There is no route name, no route
 * registry, no capability field. Those are the relay-floor organs deleted in
 * PR #2277, and endpoint addressing is what keeps them from having anywhere to
 * live (ADR-0115 clause 1).
 *
 * ## What the relay may know, and what it must not
 *
 * The relay reads the envelope only: which host endpoint, which client
 * endpoint, and the byte length and timing of a frame. It never parses the
 * `payload`: the Super Chat command types, prompt text, tool results, and
 * approval answers are opaque to it (ADR-0115 clause 2). Super Chat seals the
 * payload in its own adapters, above this transport (ADR-0115 clause 4); the
 * relay's blindness does not depend on that, because it never looks inside the
 * payload whether it carries sealed ciphertext or the self-host plaintext
 * opt-out.
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
 * A frame the host sends the relay: opaque bytes addressed to exactly one
 * client endpoint. There is no broadcast frame: the host addresses each client
 * endpoint on its own, which is what lets Super Chat seal per endpoint so the
 * relay only ever forwards per-endpoint ciphertext (ADR-0115 clause 5). Fan-out
 * to N clients is N of these, never one frame the relay expands.
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
