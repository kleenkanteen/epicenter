/**
 * The AttachRelay's one connect URL, shared by the host adapter and every
 * client so both address the relay the same way (ADR-0115).
 *
 * There is exactly one path (`/attach`): the relay is one surface, not a
 * directory of per-host or per-route endpoints. The endpoint addressing lives
 * in the query, and it is only ever the quadruple `principalId`, `hostId`,
 * `deviceId`, `attachId` plus the connecting `role`. `/attach` names the relay
 * itself, never a sub-surface of a host, so it is not a route in the sense
 * ADR-0115 forbids.
 *
 * Wave 1 carries `principalId` in the query for a loopback, plaintext proof.
 * Wave 3 replaces it with a per-device grant resolved from the bearer, the same
 * way the rooms surface resolves its principal; the addressing shape here does
 * not change.
 */

const stripTrailing = (s: string): string => s.replace(/\/+$/, '');

export const ATTACH_RELAY_ROUTE = {
	pattern: '/attach',
	/** The host endpoint's connect URL: it registers under `(principalId, hostId)`. */
	hostUrl(
		baseURL: string,
		params: { principalId: string; hostId: string },
	): string {
		const url = new URL(`${stripTrailing(baseURL)}/attach`);
		url.searchParams.set('role', 'host');
		url.searchParams.set('principalId', params.principalId);
		url.searchParams.set('hostId', params.hostId);
		return url.toString();
	},
	/** A client endpoint's connect URL: it attaches under the full quadruple. */
	clientUrl(
		baseURL: string,
		params: {
			principalId: string;
			hostId: string;
			deviceId: string;
			attachId: string;
		},
	): string {
		const url = new URL(`${stripTrailing(baseURL)}/attach`);
		url.searchParams.set('role', 'client');
		url.searchParams.set('principalId', params.principalId);
		url.searchParams.set('hostId', params.hostId);
		url.searchParams.set('deviceId', params.deviceId);
		url.searchParams.set('attachId', params.attachId);
		return url.toString();
	},
} as const;
