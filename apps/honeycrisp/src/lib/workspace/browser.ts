/**
 * Honeycrisp browser composition.
 *
 * Single source of truth for "how Honeycrisp mounts in a browser." The one
 * boot branch (ADR-0088, `connectLocalFirst`) reads `auth.state` once and
 * wires bare local storage signed-out, or owner-scoped storage plus relay
 * sync signed-in; there is no gate, the workspace is never `null`.
 *
 *  1. root doc: tables + KV, wired via `connectLocalFirst`
 *  2. per-note body child docs: each note's rich-text `Y.Doc` is wired by the
 *     same boot branch on open, not `defineWorkspace(...).connect()`'s
 *     `connectTableChildDocs` (that helper has no signed-out branch: its
 *     `ConnectionConfig` requires an `ownerId` unconditionally). This mirrors
 *     its cache-and-teardown shape using the same exported primitives
 *     `connectLocalFirst` itself is built from.
 *
 * `wipe()` drops every local IDB database this app owns on this device. Signed
 * in that is the `(server, ownerId)` prefix `wipeLocalStorage` scans (root and
 * every note body live under it); signed out it is the bare guid family (the
 * root guid plus its `<guid>.*` children), so the WorkspaceGate's
 * forget-this-device rescue works in both states. `Symbol.dispose` tears down
 * the root and cached body docs without touching local storage.
 */

import type { SyncAuthClient } from '@epicenter/auth';
import { connectLocalFirst } from '@epicenter/svelte/auth';
import {
	attachRichText,
	createDisposableCache,
	InstantString,
	type NodeId,
	onLocalUpdate,
	wipeLocalStorage,
} from '@epicenter/workspace';
import * as Y from 'yjs';
import { clearBareDoc } from './clear-bare-doc.js';
import { honeycrispWorkspace, type NoteId } from './index.js';

export function openHoneycrispBrowser({
	auth,
	nodeId,
}: {
	auth: SyncAuthClient;
	nodeId: NodeId;
}) {
	const workspace = honeycrispWorkspace.create();
	const { whenReady, collaboration } = connectLocalFirst({
		auth,
		ydoc: workspace.ydoc,
		nodeId,
		actions: workspace.actions,
	});

	const bodies = createDisposableCache((noteId: NoteId) => {
		const guid = workspace.tables.notes.docs.body.guid(noteId);
		const bodyDoc = new Y.Doc({ guid, gc: true });
		const layout = attachRichText(bodyDoc);
		const { whenReady: whenBodyReady } = connectLocalFirst({
			auth,
			ydoc: bodyDoc,
			nodeId,
		});
		// Recency: a local body edit bumps `updatedAt` on the row, matching
		// `connectTableChildDocs`'s `touch` behavior for this field.
		const offLocalEdit = onLocalUpdate(bodyDoc, () =>
			workspace.tables.notes.update(noteId, {
				updatedAt: InstantString.now(),
			}),
		);
		return {
			...layout,
			ydoc: bodyDoc,
			guid,
			whenLoaded: whenBodyReady,
			[Symbol.dispose]() {
				offLocalEdit();
				bodyDoc.destroy();
			},
		};
	});
	// One root `ydoc.destroy()` flushes every open note body, exactly as
	// `connectTableChildDocs` cascades teardown off the root.
	workspace.ydoc.once('destroy', () => bodies[Symbol.dispose]());

	const tables = {
		...workspace.tables,
		notes: {
			...workspace.tables.notes,
			docs: {
				...workspace.tables.notes.docs,
				body: {
					...workspace.tables.notes.docs.body,
					open: (noteId: NoteId) => bodies.open(noteId),
				},
			},
		},
	};

	return {
		...workspace,
		tables,
		whenReady,
		collaboration,
		async wipe(): Promise<void> {
			const state = auth.state;
			workspace[Symbol.dispose]();
			if (state.status === 'signed-out') {
				// Bare local docs name their databases after their guids, and every
				// child guid extends the root guid, so one prefix scan catches the
				// root and all note bodies (mirrors `wipeLocalStorage`'s scan).
				const guid = workspace.ydoc.guid;
				if (!('databases' in indexedDB)) return;
				const databases = await indexedDB.databases().catch(() => []);
				const names = databases
					.map((db) => db.name)
					.filter(
						(name): name is string =>
							typeof name === 'string' &&
							(name === guid || name.startsWith(`${guid}.`)),
					);
				await Promise.all(names.map(clearBareDoc));
				return;
			}
			await wipeLocalStorage({
				server: new URL(auth.baseURL).host,
				ownerId: state.ownerId,
			});
		},
		[Symbol.dispose]() {
			workspace[Symbol.dispose]();
		},
	};
}

export type HoneycrispBrowser = ReturnType<typeof openHoneycrispBrowser>;
