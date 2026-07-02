const stripTrailing = (s: string) => s.replace(/\/+$/, '');

/**
 * Wire route for a workspace sync room: `/api/rooms/:roomId`.
 *
 * Single source of truth shared by the workspace client (which builds the URL
 * in transport.ts) and the sync server (which registers the pattern). It is
 * part of the sync wire contract, so it lives in `@epicenter/sync` alongside
 * the message protocol and the auth subprotocol.
 */
export const ROOM_ROUTE = {
	pattern: '/api/rooms/:roomId',
	prefixPattern: '/api/rooms/*',
	url: (baseURL: string, roomId: string) =>
		`${stripTrailing(baseURL)}/api/rooms/${encodeURIComponent(roomId)}`,
} as const;
