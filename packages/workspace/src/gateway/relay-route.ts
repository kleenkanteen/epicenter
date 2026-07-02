/**
 * The daemon's relay-floor route opener: the endpoint gate on the relay path.
 *
 * The relay-channel acceptor ({@link ../relay-channel/acceptor}) is mechanism; it
 * holds no policy and pipes whatever this opener admits. ALL relay-path
 * authorization lives here, the device's whole admission gate: admit an inbound
 * channel only when
 *
 *   - the relay-authored `source` is THIS daemon's own principal (the relay
 *     authenticated it; a keyless caller cannot forge it), and
 *   - the named route is explicitly `relay: 'exposed'` (default refused), so a
 *     sensitive route (financial, a shell) stays refused.
 *
 * NODE-ONLY: it spawns the route child via {@link openRouteTarget}. The daemon
 * injects it into the browser-safe acceptor, so the acceptor itself stays free of
 * `node:child_process`.
 */

import type { RouteOpener } from '../relay-channel/acceptor.js';
import {
	openRouteTarget,
	type RouteTable,
	routeRelayExposed,
} from './route-table.js';

export type RelayRouteOpenerOptions = {
	/** The named, default-closed route table this daemon serves. */
	routes: RouteTable;
	/** This daemon's authenticated principal; the only source admitted. */
	ownerPrincipalId: string;
};

/** Build the relay-path {@link RouteOpener} that gates inbound channels for a daemon. */
export function createRelayRouteOpener(
	options: RelayRouteOpenerOptions,
): RouteOpener {
	const { routes, ownerPrincipalId } = options;
	return ({ route, source }) => {
		// The caller must be this principal, as the relay authenticated them.
		if (
			source?.kind !== 'principal' ||
			source.principalId !== ownerPrincipalId
		) {
			return null;
		}
		// The route must exist AND be opted in to the relay floor.
		const target = routes[route];
		if (!target || !routeRelayExposed(target)) return null;
		return openRouteTarget(target);
	};
}
