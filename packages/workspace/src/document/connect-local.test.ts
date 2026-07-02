/**
 * `connectLocal()` regression guard: the bare local-first preset (ADR-0088)
 * returns the same bundle shape as `connect()`, wired to guid-named
 * IndexedDB with no relay, INCLUDING per-row child-doc openers, and its
 * `wipe()` clears the whole bare guid family (root plus children).
 */

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { field } from '@epicenter/field';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import type * as Y from 'yjs';
import { defineTable } from './define-table.js';
import { defineWorkspace } from './workspace.js';

Object.assign(globalThis, { indexedDB, IDBKeyRange });

const originalBroadcastChannel = globalThis.BroadcastChannel;

class FakeBroadcastChannel {
	static names: string[] = [];
	onmessage: ((event: MessageEvent) => void) | null = null;
	constructor(public name: string) {
		FakeBroadcastChannel.names.push(name);
	}
	postMessage(_message: unknown): void {}
	close(): void {}
}

const model = defineWorkspace({
	id: 'clw-notes',
	name: 'CLW Notes',
	tables: {
		notes: defineTable({
			id: field.string(),
			title: field.string(),
		}).docs({ body: (ydoc: Y.Doc) => ({ text: ydoc.getText('body') }) }),
	},
	kv: {},
});

async function databaseNames(): Promise<(string | undefined)[]> {
	const dbs = await indexedDB.databases();
	return dbs.map((db) => db.name);
}

beforeEach(() => {
	FakeBroadcastChannel.names = [];
	Object.assign(globalThis, {
		BroadcastChannel:
			FakeBroadcastChannel as unknown as typeof BroadcastChannel,
	});
});

afterEach(() => {
	Object.assign(globalThis, { BroadcastChannel: originalBroadcastChannel });
});

test('bare root + bare child docs persist under guid names, no relay', async () => {
	const bundle = model.connectLocal();

	expect(bundle.collaboration).toBeUndefined();
	await bundle.idb.whenLoaded;

	bundle.tables.notes.set({ id: 'n1', title: 'first' });
	const body = bundle.tables.notes.docs.body.open('n1');
	body.text.insert(0, 'hello');
	await body.whenLoaded;

	const names = await databaseNames();
	expect(names).toContain('clw-notes');
	expect(names).toContain(bundle.tables.notes.docs.body.guid('n1'));
	// Cross-tab channels for both the root and the child, keyed by guid.
	expect(FakeBroadcastChannel.names).toContain('yjs.clw-notes');
	expect(FakeBroadcastChannel.names).toContain('yjs.clw-notes.notes.n1.body');

	bundle[Symbol.dispose]();
});

test('wipe() clears the whole bare guid family', async () => {
	const bundle = model.connectLocal();
	await bundle.idb.whenLoaded;
	bundle.tables.notes.set({ id: 'n2', title: 'doomed' });
	const body = bundle.tables.notes.docs.body.open('n2');
	body.text.insert(0, 'gone soon');
	await body.whenLoaded;

	await bundle.wipe();

	const names = await databaseNames();
	expect(names).not.toContain('clw-notes');
	expect(
		names.filter((n) => n?.startsWith('clw-notes.')),
	).toHaveLength(0);
});
