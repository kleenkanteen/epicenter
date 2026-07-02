import type { PrincipalId } from '@epicenter/identity';
import { ROOM_ROUTE } from '@epicenter/sync';
import type { NodeId } from './node-id.js';

/**
 * Options for {@link roomWsUrl}: the full base URL of the API host, the
 * workspace `ownerId` (which selects the partitioned URL path), the room
 * `guid`, and the per-client `nodeId` query value.
 */
export type RoomWsUrlOptions = {
	baseURL: string;
	ownerId: PrincipalId;
	guid: string;
	nodeId: NodeId;
};

/**
 * Build the WebSocket URL for a hosted room.
 *
 * Single URL form: `wss://<baseURL>/api/owners/<ownerId>/rooms/<guid>?nodeId=<id>`
 *
 * In per-user cloud, `ownerId` equals the signed-in user's id; on an instance
 * it is the literal `'instance'`. The URL shape is uniform across deployments.
 *
 * The path itself comes from `ROOM_ROUTE.url(...)` so server route
 * declarations and client URL construction can never drift. This wrapper
 * adds the `?nodeId=` query and rewrites the `http(s)` scheme to `ws(s)`.
 */
export function roomWsUrl(options: RoomWsUrlOptions): string {
	const httpUrl = ROOM_ROUTE.url(
		options.baseURL,
		options.ownerId,
		options.guid,
	);
	const search = `?nodeId=${encodeURIComponent(options.nodeId)}`;
	return `${httpUrl}${search}`
		.replace(/^https:/, 'wss:')
		.replace(/^http:/, 'ws:');
}
