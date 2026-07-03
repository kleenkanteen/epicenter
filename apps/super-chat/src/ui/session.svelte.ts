/**
 * The browser side of the Super Chat session: one WebSocket to `/ws`, one
 * startup fetch of `/api/tools`, and a `$state`-backed view the components
 * read. The server snapshot is the only transcript state; every `snapshot`
 * event replaces it wholesale, so the client never accumulates a second
 * transcript that could drift.
 *
 * Server types are imported type-only so no server runtime code (Hono, Bun
 * WebSocket glue) enters the browser bundle.
 */

import type { ConversationSnapshot } from '@epicenter/workspace/agent';
import type { ClientCommand, ServerEvent } from '../server.ts';

export type ToolSummary = {
	name: string;
	kind: string;
	title?: string;
	description?: string;
};

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

const RECONNECT_DELAY_MS = 1500;

export function createSession({ token }: { token: string }) {
	let snapshot = $state<ConversationSnapshot>({
		messages: [],
		streaming: null,
		isThinking: false,
		isGenerating: false,
		error: null,
	});
	let connection = $state<ConnectionStatus>('connecting');
	let tools = $state<ToolSummary[]>([]);

	let socket: WebSocket | undefined;
	let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;

	async function fetchTools() {
		try {
			const response = await fetch('/api/tools', {
				headers: { authorization: `Bearer ${token}` },
			});
			if (!response.ok) return;
			const body = (await response.json()) as { tools: ToolSummary[] };
			tools = body.tools;
		} catch {
			// The tool list is informational; the chat works without it.
		}
	}

	function connect() {
		if (disposed) return;
		connection = 'connecting';
		// The browser WebSocket constructor cannot set headers, so the token
		// rides the query string (the server gate accepts either).
		const url = new URL(
			`/ws?token=${encodeURIComponent(token)}`,
			location.href,
		);
		// Match the page's scheme: plain ws: against the loopback origin, wss:
		// when a remote overlay proxy serves this page over https.
		url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
		const ws = new WebSocket(url);
		socket = ws;
		ws.onopen = () => {
			connection = 'open';
		};
		ws.onmessage = (event) => {
			if (typeof event.data !== 'string') return;
			let parsed: ServerEvent;
			try {
				parsed = JSON.parse(event.data);
			} catch {
				return;
			}
			if (parsed.type === 'snapshot') snapshot = parsed.snapshot;
		};
		ws.onclose = () => {
			if (socket !== ws) return;
			socket = undefined;
			if (disposed) return;
			connection = 'closed';
			reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
		};
	}

	/** Returns whether the command actually went out over an open socket. */
	function sendCommand(command: ClientCommand): boolean {
		if (socket?.readyState !== WebSocket.OPEN) return false;
		socket.send(JSON.stringify(command));
		return true;
	}

	void fetchTools();
	connect();

	return {
		get snapshot() {
			return snapshot;
		},
		get connection() {
			return connection;
		},
		get tools() {
			return tools;
		},
		/** Returns whether the message went out, so the composer keeps the draft on failure. */
		send(content: string) {
			return sendCommand({ type: 'send', content });
		},
		stop() {
			sendCommand({ type: 'stop' });
		},
		retry() {
			sendCommand({ type: 'retry' });
		},
		/** Stop reconnecting and close the socket for good. */
		dispose() {
			disposed = true;
			clearTimeout(reconnectTimer);
			socket?.close();
		},
	};
}

export type Session = ReturnType<typeof createSession>;
