# Super Chat canonicalization handoff

- **Status:** In Progress
- **Date:** 2026-07-02

> **Execution note (2026-07-02):** The slice 1 source material is gone. The
> `super-app-slice1` and `super-app-host` worktrees were removed and their
> branches deleted without ever being pushed; no dangling commits, stashes, or
> PRs survive. The `chore-remove-fuji` branch landed as merged PR #2245, so the
> Fuji reconcile (step 8) came in with the `origin/main` merge. The catalog
> proof was reconstructed from the shipped primitives in
> `packages/workspace/src/agent` instead of ported; the file paths under
> "Current source material" below are dead and kept only as a record of what
> the prototype contained.
- **Decision of record:** [ADR-0084](../docs/adr/0084-super-chat-tools-load-as-vendored-typescript-the-shell-is-a-bun-hosted-local-server.md) for the local Bun shell and TypeScript loader, [ADR-0080](../docs/adr/0080-the-super-app-is-a-desktop-host-cross-device-is-remote-access-to-the-session-not-a-per-app-capability-plane.md) for the desktop-host shape.

## Why this exists

The Super Chat work is split across several local worktrees. The newest durable decision is ADR-0084 on `super-chat`; the runnable proof is still on `feat/super-app-slice1`; the Fuji removal context lives on a separate local branch. This note picks the canonical base and gives the next agent a cold-start prompt so the pieces can be merged deliberately instead of by branch archaeology.

## Canonical base

Use `/Users/braden/.herdr/worktrees/epicenter/super-chat` as the canonical worktree.

Why:

- It is clean and currently aligned with `main` at `62201622de`, the PR #2241 merge that brought in ADR-0084.
- It contains the most recent architecture decision: Super Chat loads trusted TypeScript with Bun dynamic import and uses a Bun-hosted loopback shell with a per-launch token.
- It avoids basing new work on prototype branches that predate ADR-0084 and still use `apps/super-app` naming.

Do not use these as the base:

- `/Users/braden/.herdr/worktrees/epicenter/super-app-host`: useful historical docs, but it only carries ADR-0080 and the draft build plan. It has no runnable `apps/super-app` implementation.
- `/Users/braden/.herdr/worktrees/epicenter/super-app-slice1`: useful prototype, but it is two commits ahead of `feat/super-app-desktop-host`, not the current ADR-0084 baseline. Treat it as source material to port.
- `/Users/braden/Code/epicenter-worktrees/chore-remove-fuji`: useful cleanup context. It removes Fuji and confirms that Fuji's `mount.ts` was not the Super Chat composition path. Reconcile it separately; do not make it the Super Chat base.

## Greenfield product sentence

Super Chat owns one local desktop chat session; installed apps enter through one verb catalog; the Bun sidecar owns tool loading, chat execution, static assets, and the local token gate.

That sentence refuses a few tempting branches:

- No daemon mount as the composition model. A mount is the CLI/projection path for one app, not the Super Chat host.
- No MCP for first-party in-process apps. MCP stays for boxed/upstream-constrained apps such as Local Books.
- No separate bundled Tauri SPA plus side IPC. Bun serves the SPA and the API from one loopback origin.
- No jsrepo production path until trust, pinning, and installed-state tracking are designed.
- No durable workspace opening handwave. The prototype's in-memory `create()` path is proof of composition, not the final data model.

## Current source material

Use these files as inputs:

- `docs/adr/0084-super-chat-tools-load-as-vendored-typescript-the-shell-is-a-bun-hosted-local-server.md`: current loading and shell decision.
- `specs/20260630T190000-super-app-desktop-host-build-plan.md`: existing draft execution scaffold.
- `/Users/braden/.herdr/worktrees/epicenter/super-app-slice1/apps/super-app/host.ts`: proof that one chat can compose Honeycrisp, Todos, and Local Books verbs.
- `/Users/braden/.herdr/worktrees/epicenter/super-app-slice1/apps/super-app/stdio-mcp-catalog.ts`: local stdio MCP adapter for boxed apps.
- `/Users/braden/.herdr/worktrees/epicenter/super-app-slice1/apps/super-app/remote-server.ts`: BYO-overlay WebSocket proof for viewing and driving the same host session remotely.
- `/Users/braden/.herdr/worktrees/epicenter/super-app-slice1/apps/super-app/message-store.ts`: intentionally ephemeral message-store shim.
- `/Users/braden/.herdr/worktrees/epicenter/super-app-slice1/apps/super-app/package.json`: dependency list for the prototype.
- `/Users/braden/Code/epicenter-worktrees/chore-remove-fuji`: cleanup branch to reconcile after the Super Chat base is stable.

## What is proven

The Slice 1 prototype proves the core catalog model:

```txt
Honeycrisp actions
  -> createLocalToolCatalog
  -> namespaceToolCatalog("honeycrisp")

Todos actions
  -> createLocalToolCatalog
  -> namespaceToolCatalog("todos")

Local Books stdio MCP
  -> createStdioMcpCatalog
  -> namespaceToolCatalog("localbooks")

all namespaces
  -> composeToolCatalogs
  -> createConversation
```

That is the right center of gravity. The agent loop consumes one `ToolCatalog` and does not care whether a verb came from in-process Yjs actions or a stdio MCP subprocess.

## What is not proven

ADR-0084's packaging shape is not implemented yet. The prototype does not have:

- a Hono app for Super Chat;
- static SPA serving from Bun;
- `127.0.0.1` plus `port: 0`;
- per-launch token input over stdin;
- bearer checks on every HTTP and WebSocket request;
- Tauri sidecar wiring;
- `bun build --compile` packaging;
- durable headless workspace opening;
- dynamic scanned tool-file loading;
- a tool module contract for third-party TypeScript files.

## Fuji answer to preserve

Fuji's `mount.ts` was not the intended Super Chat composition mechanism.

The mount path is for daemon/CLI projection: one folder exports one mounted app for `epicenter daemon up` or related script flows. Super Chat should compose through the isomorphic workspace/action surface for first-party apps and stdio MCP for boxed apps. If the Fuji removal branch lands first, keep that conclusion and do not replace Fuji with a new canonical daemon-mount example for Super Chat.

## Open architecture decisions

Tool module contract:
  ADR-0084 settles `scan .ts + import()`, but not what the imported file exports. The likely clean-break answer is a factory injection shape:

```ts
import type { ToolHost } from '@epicenter/super-chat';

export default function defineToolModule({
	defineQuery,
	defineMutation,
	Type,
	workspaces,
}: ToolHost) {
	return {
		weather_get: defineQuery({
			description: 'Current weather for a city',
			input: Type.Object({ city: Type.String() }),
			handler: async ({ city }) => ({ city }),
		}),
	};
}
```

Why this direction:

- Runtime imports from vendored tool files are brittle once the host is a compiled Bun binary.
- Passing `defineQuery`, `defineMutation`, and `Type` from the host avoids dual-package schema hazards.
- Passing scoped `workspaces` gives third-party tools a deliberate way to compose across installed apps.
- Type-only imports still give authors a good editor experience and erase at runtime.

Tool result shape:
  Consider splitting model-facing content from renderer-facing details before the SPA hardens. The current `AgentToolOutcome` is enough for the loop, but a table, report, or document preview should not become JSON text in a chat bubble forever.

Chat persistence:
  The prototype uses an in-memory message store. Two plausible next steps are append-only JSONL for a simple local transcript, or dogfooding an Epicenter workspace for conversation history. Do not sync sensitive tool results through a hosted readable plane without revisiting ADR-0080's confidentiality rule.

Headless durable workspace opening:
  The prototype opens apps through zero-attachment factories (`create()` / `createTodos()`), so it has no persistence, sync, IndexedDB, or SQLite. The production node opener is currently gated on a signed-in cloud session. A real Super Chat host needs an ungated local durable open path.

jsrepo:
  Keep it deferred. It can deliver source, but it does not by itself solve lockfiles, integrity, installed-state tracking, review prompts, or sandboxing.

## Recommended merge order

1. [x] Start from `/Users/braden/.herdr/worktrees/epicenter/super-chat`.
   > Merged `origin/main` first (113 commits, including the Fuji removal and the
   > ADR-0088 composition reshape) so the skeleton builds against current APIs.
2. [x] Create an `apps/super-chat` skeleton, not `apps/super-app`, unless the product name changes deliberately.
3. [x] Port the Slice 1 catalog proof from `feat/super-app-slice1`, keeping the static install list at first.
   > **Note:** Reconstructed, not ported; the prototype was unrecoverable. The
   > proof now composes Honeycrisp + Todos in-process (`defineWorkspace`
   > `create()` / `createTodos()`) plus a stdio MCP fixture, driven end to end
   > by a scripted engine in `apps/super-chat/src/host.test.ts`.
4. [x] Promote `createStdioMcpCatalog` if a second local stdio MCP consumer appears; keep it app-local for the first slice.
   > Kept app-local: `apps/super-chat/src/stdio-mcp-catalog.ts`.
5. [x] Add the Super Chat Hono/Bun server: static assets, chat API, WebSocket, loopback bind, and per-launch token gate.
   > `src/server.ts` (Hono app + WS, bearer-or-query token on every request,
   > constant-time compare) and `src/main.ts` (token over stdin, `127.0.0.1`
   > port 0, single stdout port announcement, BYOK OpenAI-compatible engine
   > from env). Static assets are a placeholder page until the SPA slice
   > exists; the serving shape (page + API from one origin) is in place.
6. [ ] Write a small ADR for the tool module contract before dynamic third-party files land.
7. [ ] Spec or implement the ungated durable local open path. This is the real gap between "composition proof" and "loads my workspaces."
8. [x] Reconcile the Fuji removal branch after the canonical app skeleton is clear, so docs do not keep pointing at a deleted app.
   > Landed upstream as PR #2245 and arrived via the `origin/main` merge; its
   > "mount is not the composition path" conclusion is preserved above and in
   > `apps/super-chat/AGENTS.md`.

## Cold-start prompt

Paste this into a fresh agent session:

```txt
You are working in the Epicenter monorepo. Use `/Users/braden/.herdr/worktrees/epicenter/super-chat` as the canonical worktree for Super Chat. Do not base new work on `feat/super-app-slice1` or `feat/super-app-desktop-host`; use them only as source material.

Goal: turn the current Super Chat architecture into the next concrete slice without losing the greenfield decisions. The canonical decision is ADR-0084: Super Chat loads trusted TypeScript through Bun dynamic import and its shell is a Bun-hosted loopback server with a per-launch token. ADR-0080 remains the desktop-host decision: local apps compose into one host session; remote devices attach to that session, not to per-app endpoints.

Important files:
- `docs/adr/0084-super-chat-tools-load-as-vendored-typescript-the-shell-is-a-bun-hosted-local-server.md`: current shell and TypeScript loading decision.
- `specs/20260630T190000-super-app-desktop-host-build-plan.md`: existing build scaffold.
- `specs/20260701T235243-super-chat-canonicalization-handoff.md`: canonicalization notes and this prompt.
- `/Users/braden/.herdr/worktrees/epicenter/super-app-slice1/apps/super-app/host.ts`: runnable proof that Honeycrisp, Todos, and Local Books can compose into one `ToolCatalog`.
- `/Users/braden/.herdr/worktrees/epicenter/super-app-slice1/apps/super-app/stdio-mcp-catalog.ts`: local stdio MCP adapter.
- `/Users/braden/.herdr/worktrees/epicenter/super-app-slice1/apps/super-app/remote-server.ts`: BYO-overlay WebSocket proof.
- `/Users/braden/Code/epicenter-worktrees/chore-remove-fuji`: cleanup context proving Fuji's `mount.ts` was not the Super Chat composition path.

Greenfield product sentence:
Super Chat owns one local desktop chat session; installed apps enter through one verb catalog; the Bun sidecar owns tool loading, chat execution, static assets, and the local token gate.

Do not reopen these decisions:
- Do not use daemon `mount.ts` as the Super Chat composition model.
- Do not use MCP for first-party in-process apps.
- Do not build a bundled Tauri SPA plus a separate IPC channel.
- Do not treat jsrepo as production-ready until trust, pinning, and installed-state tracking are designed.

Open questions to resolve explicitly:
- What exact factory-injection contract should a vendored TypeScript tool file export?
- Should Super Chat transcripts start as append-only JSONL or as an Epicenter workspace?
- What is the ungated durable local open path for installed Yjs apps?
- What belongs in the first `apps/super-chat` skeleton versus a later Tauri sidecar slice?

Suggested next actions:
1. Inspect current status with `git status --short --branch` in `super-chat`.
2. Read ADR-0084 and this handoff spec.
3. Port only the smallest useful pieces from `feat/super-app-slice1` into a new `apps/super-chat` skeleton: catalog composition, in-process app list, local stdio MCP adapter, in-memory store if needed.
4. Keep static installation first. Add dynamic scanned TypeScript only after the tool module contract ADR exists.
5. Verify with `bun run --filter @epicenter/super-chat typecheck` or the package's equivalent script once the skeleton exists, plus a runnable scripted-engine smoke test.

Repo constraints:
- Use `bun`, not npm/yarn/pnpm.
- Stage specific files only. Never use `git add .` or `git add -A`.
- Keep `AGENTS.md` as canonical instruction files; `CLAUDE.md` files are shims only.
- Do not include AI/tool attribution in commits.
```
