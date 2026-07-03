/**
 * Shared workspace shape for the two-peer cross-peer sync repro.
 *
 * Each peer's mount module calls `openNotes` with its ctx `nodeId` so both
 * peers agree on the workspace id and table schema; each runtime owns its local
 * action set separately. The only thing that differs between peers is the
 * `nodeId`. The daemon resolves that id per Epicenter root, so the two peer
 * folders get distinct ids automatically and neither peer has to hard-code an
 * identity.
 */

import { EPICENTER_API_URL } from '@epicenter/constants/apps';
import { field } from '@epicenter/field';
import {
	createWorkspace,
	defineMutation,
	defineQuery,
	defineTable,
	type NodeId,
	type OnReconnectSignal,
	type OpenWebSocketFn,
	openCollaboration,
	roomWsUrl,
} from '@epicenter/workspace';
import Type from 'typebox';

const WORKSPACE_ID = 'epicenter-notes-repro';

const Note = defineTable({
	id: field.string(),
	body: field.string(),
});

export function openNotes({
	nodeId,
	openWebSocket,
	onReconnectSignal,
}: {
	nodeId: NodeId;
	openWebSocket: OpenWebSocketFn;
	onReconnectSignal: OnReconnectSignal;
}) {
	const workspace = createWorkspace({
		id: WORKSPACE_ID,
		tables: { notes: Note },
		kv: {},
	});
	const { ydoc, tables } = workspace;

	const actions = {
		list: defineQuery({
			description: 'List all notes',
			handler: () => tables.notes.scan().rows,
		}),
		add: defineMutation({
			description: 'Add a note',
			input: Type.Object({ body: Type.String() }),
			handler: ({ body }) =>
				tables.notes.set({ id: crypto.randomUUID(), body }),
		}),
	};

	const collaboration = openCollaboration(ydoc, {
		url: roomWsUrl({
			baseURL: EPICENTER_API_URL,
			guid: ydoc.guid,
			nodeId,
		}),
		openWebSocket,
		onReconnectSignal,
	});

	return {
		workspaceId: ydoc.guid,
		actions,
		collaboration,
		whenReady: collaboration.whenConnected,
		async [Symbol.asyncDispose]() {
			workspace[Symbol.dispose]();
			await collaboration.whenDisposed;
		},
	};
}
