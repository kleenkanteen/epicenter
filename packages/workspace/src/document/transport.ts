import { ROOM_ROUTE } from '@epicenter/sync';
import type { NodeId } from './node-id.js';

/**
 * Options for {@link roomWsUrl}: the full base URL of the API host, the room
 * `guid`, and the per-client `nodeId` query value.
 */
export type RoomWsUrlOptions = {
	baseURL: string;
	guid: string;
	nodeId: NodeId;
};

/**
 * Build the WebSocket URL for a hosted room.
 *
 * Single URL form: `wss://<baseURL>/api/rooms/<guid>?nodeId=<id>`.
 *
 * The path itself comes from `ROOM_ROUTE.url(...)` so server route
 * declarations and client URL construction can never drift. This wrapper
 * adds the `?nodeId=` query and rewrites the `http(s)` scheme to `ws(s)`.
 */
export function roomWsUrl(options: RoomWsUrlOptions): string {
	const httpUrl = ROOM_ROUTE.url(options.baseURL, options.guid);
	const search = `?nodeId=${encodeURIComponent(options.nodeId)}`;
	return `${httpUrl}${search}`
		.replace(/^https:/, 'wss:')
		.replace(/^http:/, 'ws:');
}
