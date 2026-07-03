# Local Mail `up`: the app is a Bun-served same-origin SPA; native shells are optional glass

**Date**: 2026-07-01
**Status**: Draft
**Owner**: Braden
**Relates**: ADR-0084 (the pattern's origin: Super Chat's shell is a Bun-hosted local server), ADR-0098 (`docs/adr/0098-local-mail-state-round-trips-through-gmail.md`, Accepted: every human-actionable Local Mail concept round-trips through Gmail state), ADR-0080 (desktop host; phone = remote session, not per-app reach), ADR-0082 (poll-only mirror), ADR-0066 (`bun build --compile` binary + Tauri sidecar shape; now the distribution wave, not a v1 gate), `specs/20260701T140000-local-mail-phase-2-engine.md` (prerequisite engine work), `specs/20260630T150000-local-mail-tauri-cdc-mirror.md` (parent spec; its Phase 4 assumed a Tauri shell, this spec replaces that assumption)

## One Sentence

`local-mail up` runs one Bun process that both syncs the Gmail mirror and serves the mail UI as a same-origin SPA on `127.0.0.1` behind a per-launch session bearer; the v1 product is the engine plus stdio MCP, and the UI ships read-write or not at all (Phase C gates on Phase D write-through), because a read-only mail client actively desynchronizes triage.

## How to read this spec

Read first: One Sentence, Motivation, Design Decisions, Architecture, Implementation Plan. Read if changing the security model: Security (rewritten 2026-07-01 after a five-agent adversarial review; the two-token bootstrap and the Host-check invariant are load-bearing). Historical context: the parent spec's Phase 4 and its preserved `apps/email` UI appendix (the 3-pane layout carries over unchanged).

## Motivation

### Current State

Phase 1/2 give a headless engine: CLI verbs, a SQLite file, stdio MCP. That engine plus stdio MCP IS the v1 product; `up` is the human surface on top of it. The parent spec's Phase 4 says "Tauri shell and UI" and deliberately deferred the SQLite-driver question. The 2026-07-01 architecture session resolved that question (the Bun mirror is permanent; `tauri-plugin-sql` cannot host it: SQLx pooling breaks multi-statement transactions, verified against `tauri-apps/plugins-workspace`), which exposes a simpler consequence nobody had cashed in yet:

ADR-0084 already decided, for Super Chat, that a Tauri shell is a window pointed at a local Bun server (`WebviewUrl::External` at `http://127.0.0.1:<port>`). If the window is just glass over a local server, the server IS the app, and the glass is optional. The 2026-07-01 review re-confirmed this architecture: the server is the app, Tauri is optional glass, and the phone client is Gmail's own app.

This creates problems with the old Phase 4 framing:

1. **Tauri-first inverts the dependency.** Packaging, signing, and updater work would gate the first usable mail UI, while contributing nothing to the data path.
2. **A WebView-owned mirror is foreclosed anyway.** With storage staying in Bun, a bundled-`frontendDist` Tauri app would need IPC plumbing to a Bun process regardless; ADR-0084 already rejected that split ("two systems ... more moving parts than one Bun process serving both the page and its own API").
3. **A read-only UI is a worse Gmail.** Reading a message in a read-only local UI leaves it unread on the phone forever, so the user triages everything twice. That is not a smaller product; it is a product that actively desynchronizes. The UI therefore ships only with write-through: Phase C (the 3-pane UI) lands together with Phase D actions, minimum mark-read and archive, wired through the same write-through cores the CLI/MCP mutation verbs use.

### Desired State

```sh
local-mail connect      # once per device
local-mail up           # sync loop + UI server; prints http://127.0.0.1:PORT/#token=...
                        # and opens the browser; the tab is the app
local-mail mcp          # agents (unchanged)
```

For v1, `up` serves the SPA from `ui/dist` on disk; the single compiled binary that embeds the SPA is the distribution wave, triggered by the first external user or the Tauri wrap, not a v1 gate. A later Tauri app is a thin wrapper that spawns the binary as a sidecar and opens the same URL (exact ADR-0084 mechanics: port via stdout, token via stdin).

## Research Findings

Grounded 2026-07-01 via DeepWiki plus live spikes on Bun 1.3.1 (this machine).

| Question | Finding | Source |
| --- | --- | --- |
| Can Bun's HTML import embed a prebuilt Vite `dist/`? | **Refuted by live spike.** With Vite's default absolute asset paths (`src="/assets/index-*.js"`), `bun build --compile` fails outright with `error: Could not resolve`. After rewriting to relative paths it compiles, but Bun re-bundles and discards Vite's hashed filenames (the served HTML references Bun's own chunk names), and string-literal asset refs and CSS fonts would not be rewritten. Dead end, not a fallback candidate. | live spike, Bun 1.3.1 |
| Can a generated manifest of `with { type: "file" }` imports serve an embedded dist? | **Proven end to end.** A codegen step globs `ui/dist` and emits a module of static file imports keyed by URL path; routes serve `new Response(Bun.file(embeddedPath))`. Verified: byte-identical serving at the original hashed paths, correct MIME, honored `Cache-Control` and `Referrer-Policy` headers, auto-ETag, and still serving after `dist/` was deleted from disk. `--asset-naming` is unnecessary with this pattern. Imports must be static, hence the codegen step. | live spike, Bun 1.3.1 |
| Compiled size and time | apps/local-books has the identical dependency pair (`@modelcontextprotocol/sdk` + `oauth4webapi`); its `build:binary` compiles 905 modules in 0.14s to a 59MB binary that runs. The bare-Bun floor is ~58MB. The old exit gates (~150MB, ~30s) pass by an order of magnitude. | apps/local-books, this machine |
| `Bun.serve({ routes, fetch })` coexistence | Confirmed: precedence is exact, then param, then wildcard, then `fetch`; a `false` route value falls through. Verified in bun-types `serve.d.ts` (`FetchOrRoutes`, `BaseRouteValue` with `false`) and in a running compiled spike using `"/api/*": false` plus `"/*": index` for SPA deep links. | bun-types + live spike |
| Does Hono's static middleware work with embedded assets? | No. `serveStatic` from `hono/bun` reads via `Bun.file(path)` + `fs.stat` from the real filesystem only. Fine for the v1 disk-served dist; unusable for embedded assets in the distribution wave. | honojs/hono |
| Elysia instead of Hono? | Bun-first with adapters, but a real breaking-change history across 1.x (lifecycle scoping, query parsing, WS adapter removal) and a fixed-but-telling `bun build --compile` inference bug. No capability delta that matters for this surface. | elysiajs/elysia |
| Does Bun expose `flock`? | **No.** bun-types greps empty for `flock`/`F_SETLK`; the options are `bun:ffi` to libc or an `O_EXCL` lockfile, which is stale-on-crash, the exact pidfile failure this spec rejects. Replaced by `lock.db` `BEGIN EXCLUSIVE` (see Edge Cases), verified live: a second process is refused instantly ("database is locked"); after `kill -9` of the holder, the next process acquires immediately. | bun-types + live test, this machine |

**Key finding**: the embedded-manifest path works and the numbers are known, but at n=1 with no external user, compile-embed is distribution work. The security claim "the SPA has zero external subresources" is a property of the SPA, not of the packaging; a disk-served dist on the same origin has the identical property.

**Implication**: v1 `up` serves `ui/dist` from disk. The route table is the stable seam; the distribution wave swaps the file source for the proven embedded-manifest imports without touching routes.

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| v1 static serving | 3 taste | Serve `ui/dist` from disk (Bun.file-backed routes or Hono `serveStatic`; implementer's choice) | Compile-embed is distribution work at n=1; the "zero external subresources" property belongs to the SPA, not the packaging. The route table is the stable seam. Revisit when: the distribution-wave trigger fires (first external user or the Tauri wrap) |
| Embedded serving (distribution wave) | 1 evidence | Codegen'd manifest of `with { type: "file" }` imports; HTML import refused | HTML import refuted by live spike (compile error on absolute paths; re-bundling discards Vite's hashes); manifest path proven byte-identical end to end (see Research Findings) |
| Route/fetch split | 1 evidence | `Bun.serve({ routes, fetch })`: `"/api/*": false` falls through to the Hono fetch handler; `"/*"` serves the SPA with an index fallback for deep links | Verified against bun-types `serve.d.ts` and a running compiled spike |
| API framework | 3 taste | Hono in the `fetch` fallback, weakly recommended | Honest reclassification: local-mail shares zero code with `packages/server` (different bearer model too), Bun routes natively give param routing and per-method handlers, and a bearer check is ~6 lines. But the carrying cost is near zero and Phase D mutation endpoints will want shared middleware (auth, validation, error mapping). Revisit when: the `/api` surface stays at ~4 routes through Phase 3, in which case inline the bearer check and drop Hono |
| Elysia | 2 coherence | Refused | Second framework in the repo for zero capability delta; real 1.x breaking-change history (lifecycle scoping, query parsing, WS adapter removal) and a fixed-but-telling `bun build --compile` inference bug. Verified: elysiajs/elysia |
| Process model | 1 evidence | One process: sync loop + server. Sync is serialized through one in-process gate | Sync is I/O-bound: every `history.list`/`messages.get` awaits and yields the event loop, so `/api` requests are served in the gaps; bun:sqlite transactions are short (one `messages.list` page, ~100 rows). The real fix is re-entrancy: `up`'s loop and `POST /api/sync` must not both call `syncMailbox` concurrently, so both go through one serialize gate (see Architecture) |
| Read-only UI | product | Refused: Phase C ships only together with Phase D | A read-only mail UI actively desynchronizes: reading a message locally leaves it unread on the phone forever, forcing double triage. Minimum write-through for the first shipped pane: mark-read and archive |
| Auth model | 1 evidence | Two tokens: a single-use bootstrap token in the URL fragment, exchanged at `POST /api/session` for a per-launch session bearer stored in sessionStorage | Fragments never reach the server (no request or access logs, no Referer); sessionStorage survives F5 within the tab and is unreadable by the sandboxed mail-body iframe. Full model in Security |
| Dev-mode auth | 2 coherence | `bearerAuth` is never disabled in any mode; dev uses a fixed token via `LOCAL_MAIL_TOKEN`, injected server-side by the Vite proxy | The dev mirror is the developer's real mailbox, and loopback is not a browser boundary: with auth off, any website in the dev browser can fire a no-preflight `POST /api/sync`. Details in Security |
| Single instance | 1 evidence | Dedicated `lock.db` held with `BEGIN EXCLUSIVE` for process lifetime; `flock` refused | Bun has no flock API (verified against bun-types); an `O_EXCL` lockfile is the pidfile failure again. `lock.db` verified live including `kill -9` release (see Edge Cases) |
| UI stack | 2 coherence | SvelteKit with adapter-static in SPA mode (fallback `index.html`), Svelte 5, `@epicenter/ui`, tailwind, in `apps/local-mail/ui/` mirroring `apps/api/ui` | `apps/api/ui` is the repo precedent for an app-owned SPA. Honest note: `apps/api/ui` is served by the Cloudflare ASSETS binding at the edge, so local-mail is the pathfinder for an app that serves its own SPA |
| Build pipeline | 2 coherence | `vite build` emits `apps/local-mail/ui/dist/`; `up` serves it from disk; never commit `dist/` | Keeps source-of-truth in `ui/src`. `bun build --compile` moves to the distribution wave |
| SSR / SvelteKit server | 2 coherence | Refused; static SPA only | There is no server rendering need on localhost; the Bun process serves bytes and JSON |
| Native shell | 3 taste | Browser tab first; Tauri wrapper deferred until dock/tray/autostart is demanded | The wrapper is additive glass over the same URL; building it first gates UI on packaging. Revisit when: a user-visible need for dock badge, tray, autostart, or window management appears |
| Phone surface | decided in ADR-0098 | None; Gmail's own app is the phone client | The invariant lives in ADR-0098 (Accepted, created in this design pass): every Local Mail concept a human acts on must round-trip through Gmail state; local-only snooze, send-later, and local read-state are refused until a future ADR accepts device-bound behavior; local derived or advisory data is allowed when rebuildable and never gating handled-semantics |

ADR plan: after `up` ships and the distribution-wave gates pass, write the general ADR ("a local app's shell is a Bun-served same-origin SPA; native windows are optional glass", generalizing ADR-0084 beyond Super Chat, second consumer = Local Mail). In the same change, amend ADR-0084: flip it to Accepted (its unprototyped-packaging caveat is discharged), soften its "deliberate, scoped divergence for one app" sentence, and correct its threat-model wording (the token is the browser and multi-user boundary; OS file permissions are the same-user boundary; ADR-0084 currently claims the token defends against any same-machine process). The durable Host-validation lesson from the local-books incident ("loopback plus CORS is not an authz boundary; validate Host and require the bearer on every mutation") belongs in that ADR too.

## Architecture

```
local-mail up
  |
  |-- generates two tokens (CSPRNG, >= 128 bits each, base64url):
  |     bootstrap token (single-use, carried only in the URL fragment)
  |     session bearer  (per-launch, handed out at the exchange)
  |-- acquires lock.db via BEGIN EXCLUSIVE (see Edge Cases); if held, reads the
  |     bound port out of lock.db and prints "already running at
  |     http://127.0.0.1:PORT" instead of just refusing
  |-- Bun.serve({ hostname: '127.0.0.1', port: 0 })
  |     Host check FIRST: any request whose Host is not exactly
  |       127.0.0.1:<actual port> is rejected 403 before routing
  |     routes:
  |       "/api/*": false            (fall through to fetch)
  |       "/*": ui/dist files        (disk-served v1; index.html fallback for
  |                                   SPA deep links; embedded manifest later)
  |     fetch fallback: Hono app
  |       POST /api/session          exchange bootstrap -> session bearer
  |                                  (the only unauthenticated mutation;
  |                                   Host-checked and rate-limited)
  |       bearerAuth on all other /api/*
  |       GET  /api/status           cursor, counts, account, last sync
  |       GET  /api/threads          list (from messages GROUP BY thread_id)
  |       GET  /api/threads/:id      messages in thread (raw JSON projected)
  |       POST /api/sync             request one poll pass ("refresh now")
  |       (Phase D lands: POST /api/messages/:id/read|archive -> write-through cores)
  |-- syncGate: a single in-process promise chain; runSyncLoop and POST /api/sync
  |             both enqueue onto it, so at most one syncMailbox pass runs at a
  |             time. POST /api/sync coalesces onto the in-flight pass.
  |-- runSyncLoop(deps)              same process, same bun:sqlite handle
  |-- writes the bound port into lock.db; prints
  |     http://127.0.0.1:PORT/#token=<bootstrap>; attempts `open`
  |
  mail.db (WAL)  <-- concurrent read-only opens: `local-mail mcp`, `query`, agents
```

The bootstrap flow, end to end:

```
GET /                     -> public static index.html; the fragment never leaves
                             the browser, so the token is never in a request
                             line, access log, or Referer
SPA reads location.hash   -> history.replaceState strips it immediately
POST /api/session         -> server validates AND invalidates the bootstrap
  { token: <bootstrap> }     token, returns the session bearer
sessionStorage stores it  -> every /api call sends Authorization: Bearer <session>
F5 / same-tab restore     -> sessionStorage survives; no re-bootstrap needed
```

This design also dissolves a routing bug the review found in the previous draft: the old diagram sent `GET /?token=` through the Hono fallback, but the SPA `"/*"` route matches `/` first, so Hono would never have seen the bootstrap and the one-time invalidation could never run. With the fragment design, `GET /` is purely public static and the exchange happens on an API route Hono actually owns.

`syncGate` is the fix for the re-entrancy the earlier grill found: without it, `up`'s background loop and a concurrent `POST /api/sync` could each read the same cursor, fetch overlapping `history.list` windows, and commit different `newHistoryId` values, flapping the cursor backward (self-healing on the next pass by the engine's idempotent re-pull, but wasteful and confusing). One gate makes passes strictly sequential within the process. Cross-process sync (the `mcp` `sync` tool or a stray `local-mail sync` while `up` runs) stays safe by the engine's existing discipline, verified against the code: the cursor write is transactional with the batch apply (db.ts:263-282), each pass reads the cursor fresh from the db, so two passes from the same baseline reach the same `newHistoryId` and any re-pull is idempotent. It is wasteful, not corrupting; `lock.db` on `up` prevents the common case (two `up`s), and nothing else runs a hot loop.

Two refinements from the engine review:

- `runSyncLoop` currently hardcodes `syncMailbox` (sync.ts:389), so Phase B needs an injection seam (the loop takes a `runPass` function, or the gate wraps deps); without one the gate is untestable.
- Coalescing nuance: returning the in-flight pass's result can hand a "refresh now" caller a pass that started before their click; the standard fix is coalesce-to-one-trailing-pass, and living without it is acceptable for v1.

The review also found a full-pull baseline ghost window in the engine (fixed by calling `getProfile` before page 1); that is engine work, Phase 2 Wave 2a.4, referenced here only so nobody re-litigates it in this spec.

The Tauri wrapper, when earned, is exactly ADR-0084's sidecar recipe: spawn this binary, read the port from stdout, pass the token over stdin, `WebviewUrl::External`. Nothing in the engine or UI changes. The same applies if this pattern later becomes the super app host's shell (`apps/epicenter`): Local Mail is the pathfinder for the packaging, not a divergence.

## Security

State the threat model first, because several findings dissolve once it is explicit.

```txt
The token defends against:
  - other browser origins (a malicious website your browser also has open,
    trying to reach 127.0.0.1 via CSRF or DNS rebinding)
  - other users on a multi-user machine

The token does NOT defend against:
  - another process running as the SAME user
    (it can already read mail.db and credentials.json directly; the token
     is not the boundary there, the OS file permissions are)
```

That resolves the "token visible in `ps`/argv" objection: a same-user process that could read the token from `ps` can already read the mirror and the refresh token off disk, so leaking the bearer to it changes nothing. The bearer's job is the browser and multi-user boundary, and it does that job.

One honesty note the review forced: the "OS file permissions are the same-user boundary" claim is currently false in code. `mail.db` is created world-readable at umask; only `credentials.json` gets 0600. The fix is engine work, Phase 2 Wave 2a.5 (0700 data dirs; 0600 on the db and its `-wal`/`-shm` siblings); the threat-model text above is conditioned on that wave landing. Relatedly, ADR-0084's own wording claims the token defends against same-user processes, which is wrong; correct it when the shell-generalization ADR lands (see the ADR plan above).

### Two-token bootstrap

The old one-token query-param bootstrap is replaced by a two-token model.

- **The URL carries a single-use bootstrap token in the fragment** (`/#token=...`), never the query string. Fragments never reach the server, so the token never lands in request or access logs and never sits in Referer. The SPA reads `location.hash`, immediately strips it with `history.replaceState`, and POSTs it to `POST /api/session` to exchange for the per-launch **session bearer**, which it stores in sessionStorage. The server validates and invalidates the bootstrap token at the exchange, not at page load.
- **Why sessionStorage and not in-memory**: in-memory dies on F5 or tab restore, and with the bootstrap spent the user would be locked out until `up` restarts (the previous draft never resolved this, and its Edge Cases already implied two tokens without saying so). sessionStorage survives reload within the tab, dies with the tab, and is unreadable by the mail-body iframe: sandboxed without `allow-same-origin`, the frame has an opaque origin and no access to the app origin's storage. The app origin has no script-injection vector because mail bodies never execute JS (see rendering below).
- **Cookie steelman, resolved**: httpOnly plus SameSite would also work but reintroduces the browser-heuristic CSRF class and auto-attaches to every same-origin request; the bearer keeps the CSRF-immunity argument intact (a cross-origin page cannot set a custom header without a CORS grant we never give), and the sessionStorage exchange removes the reload disadvantage that was the cookie's only real edge.
- **Entropy and rate limit**: both tokens are at least 128 bits from a CSPRNG, base64url. `POST /api/session` is the only unauthenticated mutation endpoint; it must be Host-checked and rate-limited (reject after N failed exchanges, or accept only within a short post-launch window) to bound online guessing by other local users.

### Non-negotiable invariants

- **Host validation (the DNS-rebinding kill switch)**: every request must carry a Host header exactly equal to `127.0.0.1:<actual port>`; anything else is rejected 403 before routing. Today every endpoint happens to be either public or bearer-gated, but that safety is emergent, not stated; Phase D write endpoints or the deferred `/ws` (where ADR-0084 plans a weaker query-param token because WebSocket cannot set headers) would silently reopen the class. When `/ws` lands, additionally reject any present Origin header that is not `http://127.0.0.1:<port>`. Precedent, verified in this repo's history: the local-books daemon `/mcp` CORS write-vector (loopback bind plus CORS guards reads only; cross-origin no-preflight POSTs still execute server-side). The durable lesson, "loopback plus CORS is not an authz boundary; validate Host and require the bearer on every mutation", should land in the shell-generalization ADR.
- **Account-invariant pre-auth surface**: no response reachable without a valid session bearer may contain account-derived data; `GET /` and all static assets are byte-identical regardless of connected account. This is what makes a rebound-origin read of the token-free surface harmless.
- **Bind `127.0.0.1` only**; never `0.0.0.0`, never LAN. Remote access is out of scope (ADR-0080: the phone views a session, not a port).
- **Static assets are token-free** (they are public code; the data is behind `/api`). Do not let the SPA bake any account state into a cacheable static response. If a service worker is ever added, key its cache to never store the bootstrap URL. `Referrer-Policy: no-referrer` on every response stays as belt-and-suspenders; the load-bearing property (the initial page has zero external subresources) belongs to the SPA itself and holds identically for the disk-served dist.

### Dev mode

`bearerAuth` is never disabled in any mode. The Vite proxy can carry the credential: dev uses a fixed token via `LOCAL_MAIL_TOKEN`, read by both the Bun process and `vite.config.ts`; the proxy injects `Authorization: Bearer` server-side with `changeOrigin: true` so the Host check passes. `LOCAL_MAIL_TOKEN` is honored only when `LOCAL_MAIL_DEV=1`; production always generates a random token and ignores the env. (The previous draft's skip-auth dev mode was wrong twice: the dev mirror is the developer's real mailbox, and loopback is not a browser boundary; with auth off, any website in the dev browser can fire a no-preflight `POST /api/sync`.)

### Residual risks, documented not solved

- A browser extension with URL-read permission sees the fragment before `replaceState` runs. Unmitigable at the app layer (the extension is inside the browser) and same-machine.
- A token pasted into another browser profile works within its lifetime; the single-use bootstrap limits the window, and the session bearer is never in the URL.
- "Show images" re-enables more than tracking pixels; see the rendering rules below for the precise scope.

### Mail body rendering (the Phase C invariant)

Rendering mail bodies is the real attack surface. The invariant, stated concretely:

- **Sandbox**: iframe with NEITHER `allow-scripts` NOR `allow-same-origin`; mail bodies cannot run JS at all and cannot reach the app origin (this is why the app origin has no XSS vector; the auth model relies on it). No `allow-top-navigation`; links are intercepted to `target=_blank rel=noopener noreferrer` and never navigate the app window. Load via `srcdoc` with sanitized HTML, not a `blob:` URL.
- **CSP delivery**: a srcdoc iframe sandboxed without `allow-same-origin` has an opaque origin and no HTTP response, so NO response header governs it and the parent's CSP does not cascade. The CSP must be a `<meta http-equiv="Content-Security-Policy">` injected as the first child of `<head>` INSIDE the srcdoc string. This must be explicit or an implementer will set a header on the JSON response and ship a frame with no CSP.
- **What the CSP is for**: with no `allow-scripts`, no JS runs; the live exfiltration vectors are passive subresource loads (img, CSS background `url()`, `@font-face`, video poster, SVG image, link prefetch). Policy: `default-src 'none'; img-src 'none'` (or the loopback proxy origin when images are shown); `style-src 'unsafe-inline'; font-src 'none'; media-src 'none'; connect-src 'none'; script-src 'none'; base-uri 'none'; form-action 'none'`.
- **Sanitizer, non-negotiable**: DOMPurify, before the HTML ever reaches srcdoc. Config: `FORBID_TAGS` script, style, link, base, meta, iframe, object, embed, form (style is handled by the CSS rule below); `FORBID_ATTR` srcset; no `ALLOW_UNKNOWN_PROTOCOLS`; href/src protocol allowlist http, https, mailto. Ordering: sanitize, then inject the CSP meta, then assemble srcdoc; raw mail HTML is never assigned to any innerHTML. Whether DOMPurify runs client-side in the SPA (its native habitat) or server-side via linkedom is a build-time pick; both are acceptable.
- **Show-images precision**: enabling images for a message re-enables CSS `url()` and therefore CSS attribute-selector exfiltration for that message, not just tracking pixels. Rule: "show images" allows `img` elements only; CSS `url()` in style attributes and blocks stays stripped even in show-images mode. Recommended (decide in Phase C): route shown images through the local Bun process as a stripping proxy, so `img-src` stays loopback-only and remote hosts never see the client IP.
- Remote images are blocked by default; "show images" is per-message opt-in.

## Implementation Plan

### Phase B: `up` verb

Prerequisites: engine Wave 2a has landed (so the `SCHEMA_VERSION` bump never runs under a live server) and Wave 2c's `cli.ts` dispatch adoption (so `up` lands on the final dispatch shape).

- [ ] **B.1** `up` = `lock.db` acquire + two-token generation + `Bun.serve` (Host check first, routes, Hono fetch fallback) + `runSyncLoop` through `syncGate`, one process; write the bound port into `lock.db`; print `http://127.0.0.1:PORT/#token=...`; `open` on macOS.
- [ ] **B.2** `POST /api/session` exchange: validate and invalidate the bootstrap token, return the session bearer, rate-limit failed exchanges; `bearerAuth` on all other `/api/*`.
- [ ] **B.3** `/api/status`, `/api/threads`, `/api/threads/:id`, `POST /api/sync` as thin adapters over existing cores (read-only queries + `syncMailbox` through `syncGate`). Give `runSyncLoop` its injection seam (it hardcodes `syncMailbox` at sync.ts:389; either the loop takes a `runPass` function or the gate wraps deps), or the gate is untestable.
- [ ] **B.4** Serve `ui/dist` from disk behind the Host check (Bun.file-backed routes or Hono `serveStatic`; the route table is the seam the distribution wave later swaps).
- [ ] **B.5** Dev loop: `vite dev` serves the SPA and proxies `/api` to the Bun process with the `LOCAL_MAIL_TOKEN` injection described in Security; `bearerAuth` stays on.

### Phase C: UI (ships only together with Phase D)

Gate: Phase C does not ship read-only. It lands in the same release as Phase D's minimum actions, or it does not land.

- [ ] **C.1** 3-pane inbox per the preserved appendix (rail, dense list, thread viewer; `j/k`, `Cmd+K`), as a SvelteKit adapter-static SPA in `apps/local-mail/ui/`.
- [ ] **C.2** Body rendering behind the sanitizer + srcdoc CSP invariant (see Security). Decide the show-images proxy here.
- [ ] **C.3** "Refresh now" wired to `POST /api/sync` (collapses the poll-wait term of new-mail latency).

Known unknown to resolve early in Phase C: fragment-token handling timing versus SvelteKit hydration; client code must read and strip `location.hash` before, or independent of, router navigation.

### Phase D: actions (the gate that lets Phase C ship)

Depends on engine Phase 3 write-through (`gmail.modify` re-consent is one command once `connect` exists).

- [ ] **D.1** Mark-read and archive from the UI, minimum, through the same write-through cores the CLI/MCP mutation verbs use; label edits follow.

### Distribution wave (former Phase A; not a v1 gate)

Trigger: the first external user, or the Tauri wrap. Until then, `bun run` from the monorepo plus the disk-served dist is the product.

Carried evidence (recorded in Research Findings): HTML import refuted; embedded-manifest codegen proven byte-identical end to end with correct MIME, cache headers, auto-ETag, and no filesystem dependency; 905 modules / 0.14s / 59MB on the identical dependency pair.

Remaining exit gates:

- [ ] Codegen at real SvelteKit scale: dozens of files under `_app/immutable/` with nested directories; the manifest pattern is proven only at toy scale.
- [ ] An MCP stdio session smoke test from inside a compiled binary; compile-clean does not guarantee the SDK's runtime behavior.

Notes: pin the Bun version in CI; the `routes` API surface is young. Success criterion for this wave: one binary serves the SPA and `/api` with zero filesystem asset reads.

## Edge Cases

- **Two `up` processes, same account**: WAL makes it safe but wasteful (duplicate polling). Mechanism: a dedicated `lock.db` in the account's data dir (`<dataDir>/<account>/`), opened via bun:sqlite with `PRAGMA busy_timeout=0` then `BEGIN EXCLUSIVE`, held for process lifetime. Verified on this machine: a second process is refused instantly ("database is locked"); after `kill -9` of the holder, the next process acquires immediately (the kernel releases the fcntl lock; no stale state, unlike a pidfile). Footnote: never open `lock.db` from a second handle in the same process; POSIX fcntl drops locks when any fd to the file closes. The bound port is stored inside `lock.db`, so a second `local-mail up` prints "already running at http://127.0.0.1:PORT" instead of just refusing. The lock is per-account because it lives in that account's data dir, so two different accounts each `up` freely.
- **`SCHEMA_VERSION` bump while serving**: the drop-and-rebuild runs at open time, before the server starts, and Phase B's prerequisite (engine Wave 2a landed first) means the bump never happens under a live server.
- **`POST /api/sync` while a loop pass is running**: coalesced by `syncGate`; the caller gets the in-flight pass's result. Nuance: that pass may have started before the caller's click; coalesce-to-one-trailing-pass is the standard fix and is deferred, acceptable for v1.
- **F5 or lost session**: F5 keeps working (the session bearer lives in sessionStorage, scoped to the tab). A fresh tab or another profile after the bootstrap is spent has no way in; recovering a lost session is restart-`up` for v1, with a possible future `open` verb (mint a new bootstrap for the already-running server) as an open question.
- **Token pasted into another browser profile, same machine**: works by design within its lifetime (it is the credential), but the bootstrap is invalidated at first exchange, so only a still-unspent bootstrap or the live session bearer works, and the bearer is never in a URL. Acceptable; documented.

## Open Questions

1. **FTS5 timing.** `body_text` lands in engine Wave 2a.2, so MCP content queries work with `LIKE` from the start; FTS5 waits for a search UI. Recommendation: keep waiting; `LIKE` over 2k messages is fine until the search box exists.
2. **Port stability.** Ephemeral (`port: 0`) vs pinned config. Recommendation: ephemeral + printed URL for v1; add `--port` only when someone actually wants a bookmark.
3. **Lost-session recovery.** Is a `local-mail open` verb (print or mint a fresh bootstrap URL for the running server, via the port in `lock.db`) worth having, or is restarting `up` fine indefinitely? Recommendation: restart-for-v1; revisit on the first real annoyance.
4. **Does `up` replace `sync --watch`?** Recommendation: keep `--watch` (headless servers and tests want it); `up` is `--watch` plus the served UI.

(The old binary-distribution question folded into the distribution wave's trigger.)

## Do not build yet

- Compile-embed distribution (until an external user or the Tauri wrap; the evidence is banked in Research Findings).
- The Tauri wrapper (until dock/tray/autostart is demanded).
- Any LAN or remote exposure of the server.
- WebSockets (poll `GET /api/status` from the SPA first; a push channel to the *local* UI is additive later via `hono/bun` `upgradeWebSocket`, and must land with the Origin check named in Security).
- Multi-account UI (the engine supports multiple accounts; the UI starts with one).
- Anything phone-specific.

## Success Criteria

- [ ] `up` serves the SPA from `ui/dist` behind the Host check and the bearer; no request with a non-loopback Host reaches a route.
- [ ] An F5 reload keeps working (the sessionStorage exchange survives reload without a new bootstrap).
- [ ] A new email appears within propagation + one poll interval; "refresh now" collapses the wait.
- [ ] `local-mail mcp` and CLI `query` keep working against the same `mail.db` while `up` runs.
- [ ] Marking a message read in the UI shows as read on the phone (the write-through gate criterion).
- [ ] No request path reads `credentials.json` from the server surface (tokens stay engine-internal).

(The old "zero filesystem asset reads" criterion moved to the distribution wave's exit gates.)

## References

- `docs/adr/0084-*.md`: the security model and sidecar mechanics this reuses, and the ADR to amend when the generalization lands.
- `docs/adr/0098-local-mail-state-round-trips-through-gmail.md` (Accepted): the phone-surface invariant.
- `specs/20260701T140000-local-mail-phase-2-engine.md`: Waves 2a.2 (body_text), 2a.4 (getProfile-before-page-1), 2a.5 (file permissions), 2c (dispatch shape) that this spec depends on or references.
- `specs/20260630T150000-local-mail-tauri-cdc-mirror.md` Appendix: the 3-pane UI shape and Gmail scope/CASA research.
- `apps/api/ui/`: the repo's app-owned SvelteKit adapter-static SPA precedent (served by the Cloudflare ASSETS binding there; self-served here).
- `apps/local-books/src/commands/mcp.ts`: proof of N-process access to one WAL SQLite file.
- The local-books daemon `/mcp` CORS write-vector (this repo's history): the precedent behind the Host-validation invariant.
