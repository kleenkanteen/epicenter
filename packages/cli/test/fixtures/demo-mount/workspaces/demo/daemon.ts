/**
 * Minimal fixture: one local mount with no sqlite, encryption, or real
 * WebSocket. A hand-stubbed `collaboration` covers the peer and sync-status
 * fields the watcher reports on stderr.
 */

import { defineMount } from '@epicenter/workspace/daemon';
import * as Y from 'yjs';

const ydoc = new Y.Doc({ guid: 'epicenter-demo' });

const collaboration = {
	status: { phase: 'connected' as const },
	whenConnected: Promise.resolve(),
	whenDisposed: Promise.resolve(),
	onStatusChange: () => () => {},
	reconnect: () => {},
	peers: {
		list: () => [],
		subscribe: () => () => {},
	},
	[Symbol.dispose]() {
		ydoc.destroy();
	},
};

export const demoRuntime = {
	workspaceId: ydoc.guid,
	collaboration,
	async [Symbol.asyncDispose]() {
		ydoc.destroy();
	},
	ydoc,
};

export default defineMount({
	name: 'demo',
	open: () => demoRuntime,
});
