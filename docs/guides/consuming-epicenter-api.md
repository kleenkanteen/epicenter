# Consuming the Epicenter API

> **Historical note.** Earlier drafts of this guide described a
> `createWorkspace(definition).withEncryption().withExtension(...)` builder
> chain, and later an owner factory that wrapped the encryption, local
> storage, and per-owner wipe paths behind a single object. Both shapes
> are gone. There is one pattern today: `createWorkspace()` builds the low-level
> bundle, `create<App>()` defines the app's shared isomorphic model,
> and `open<App>Browser()` attaches browser storage and sync inline.
>
> Rather than maintain two versions of the same narrative, this guide also
> points at the canonical sources:
>
> - **Quick Start**: [`packages/workspace/README.md`](../../packages/workspace/README.md)
> - **Multi-node sync**: [`packages/workspace/SYNC_ARCHITECTURE.md`](../../packages/workspace/SYNC_ARCHITECTURE.md)
> - **Production wiring**: `apps/honeycrisp/src/lib/workspace/browser.ts` (inline composition with per-row child docs), `apps/honeycrisp/src/lib/honeycrisp.ts` (boot singleton), `apps/tab-manager/src/lib/session.svelte.ts` (browser extension auth binding)

## Overview

The hosted hub at `https://api.epicenter.so` handles auth, real-time sync, and AI inference. It runs on Cloudflare Workers with Durable Objects. Cloud sync enters through `/api/owners/:ownerId/rooms/:roomId` (the same path in per-user cloud and self-hosted instance deployments): a cloud doc is owned by the resolved `ownerId` and addressed by its `ydoc.guid`, and the server resolves the room from the auth token. Browser apps and the workspace daemon both use this route.

On the client, `@epicenter/workspace` exposes the presets directly: define your schema with `defineTable` / `defineKv`, wrap it with `defineWorkspace({ id, tables, kv, actions })`, then choose the browser storage branch once at boot. Signed out calls `connectLocal()` for bare local IndexedDB storage. Signed in calls `connect({ ...projectSignedIn(auth), nodeId })` for owner-scoped storage plus relay sync.

## Minimal cloud workspace shape

This snippet shows the current browser shape. The per-app browser opener is the single source of truth for "how this app mounts in a browser." It reads `auth.state` once, so owner changes reload the page and rerun the branch.

```typescript
import type { SyncAuthClient } from '@epicenter/auth';
import { field } from '@epicenter/field';
import { projectSignedIn } from '@epicenter/svelte/auth';
import {
	createNodeId,
	defineActions,
	defineMutation,
	defineTable,
	defineWorkspace,
	type NodeId,
} from '@epicenter/workspace';
import Type from 'typebox';
import { auth } from './auth';

const notes = defineTable({
	id: field.string(),
	title: field.string(),
});

export const myAppWorkspace = defineWorkspace({
	id: 'epicenter.my-app',
	name: 'my-app',
	tables: { notes },
	kv: {},
	actions: ({ tables }) =>
		defineActions({
			notes_create: defineMutation({
				description: 'Create a note',
				input: Type.Object({ id: Type.String(), title: Type.String() }),
				handler: ({ id, title }) => {
					tables.notes.set({ id, title });
				},
			}),
		}),
});

export function openMyAppBrowser({
	auth,
	nodeId,
}: {
	auth: SyncAuthClient;
	nodeId: NodeId;
}) {
	return auth.state.status === 'signed-out'
		? myAppWorkspace.connectLocal()
		: myAppWorkspace.connect({ ...projectSignedIn(auth), nodeId });
}

export const myApp = openMyAppBrowser({
	auth,
	nodeId: createNodeId({ storage: localStorage }),
});
```

The `ydoc.guid` is the bare local IndexedDB key and the cloud room id. Namespace it to your app, for example `epicenter.my-app`, to avoid collisions when multiple apps share the same IndexedDB origin. Signed-in storage adds the owner prefix, so two owners on the same browser profile never share data.

`connectLocal()` returns the local-only bundle: IndexedDB, BroadcastChannel, `wipe()`, and child-doc openers, but no relay. `connect(connection)` returns the same bundle shape with owner-scoped storage and collaboration. The app shell should not branch on auth after this point; signed-in-only features should degrade inline.
