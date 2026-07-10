# Epicenter trusted SPA host production integration

- **Status:** In Progress
- **Date:** 2026-07-09
- **Owner:** Braden
- **Relates:** `docs/adr/0080-the-super-app-is-a-desktop-host-cross-device-is-remote-access-to-the-session-not-a-per-app-capability-plane.md`, `docs/adr/0084-super-chat-shell-is-a-bun-hosted-local-server-not-a-bundled-spa.md`, `docs/adr/0111-super-chat-v1-exposes-built-in-epicenter-apps-and-defers-extension-surfaces.md`, `docs/adr/0113-super-chat-session-commands-are-host-owned-transports-only-frame-them.md`, `docs/adr/0116-local-mail-is-desktop-first-one-bun-engine-no-background-mail-service.md`
- **Proposed ADR:** `docs/adr/0118-epicenter-is-one-trusted-bun-hosted-spa-origin.md`
<!-- doc-path-check: ignore-next-line -->
- **Prototype evidence:** `specs/20260709T220000-epicenter-mail-launcher-prototype.md`
- **Decision scope:** Promote Super Chat to Epicenter, make one Bun origin the trusted host for every SPA, absorb Whispering's native runtime, and establish the first production milestone without legacy-data migration or installable-app machinery.

## How to read this spec

Read first:

- One sentence
- Product contract
- Target architecture
- First milestone
- Verification

Read before changing architecture or security:

- Stable application origin
- Trust model
- Tauri remote authority
- Whispering ownership
- Explicit refusals

This is implementation scaffolding, not the durable decision record. Before implementation changes the accepted product topology, write a Proposed ADR that promotes ADR-0084 from a Super Chat-specific decision to the Epicenter application-host decision. Delete this spec after the migration lands.

## One sentence

Epicenter is one signed Tauri application that boots one trusted Bun host on a stable loopback origin, serves every trusted SPA from that origin, lets those WebViews invoke focused Rust capabilities, and keeps each app's durable data in its honest store.

## Product contract

The product intentionally accepts two strong constraints:

1. Epicenter does not operate without its bundled Bun host.
2. Installing an Epicenter SPA means trusting that SPA with Epicenter's granted native authority.

These constraints delete a second UI hosting mode, degraded no-Bun operation, a sandboxed app class, and per-surface native trust policy.

The user-visible product is still one application:

```txt
Epicenter.app
  Query
  Whispering
  Mail
  Books
  future trusted installed SPAs
```

macOS sees one bundle, one process identity, one TCC identity, one updater, one tray owner, and one login item. A thin launcher may open a named surface, but it never becomes a runtime.

## Current evidence

### Query already proves the Bun-hosted shape

`apps/epicenter` already has the Query server mechanics:

- `src/main.ts` accepts a per-launch credential over stdin.
- Bun binds loopback and reports readiness to its parent.
- `src/server.ts` serves the SPA, API, and WebSocket session.
- `src/host.ts` owns the Query session and built-in tool catalog.
- ADR-0084 already chooses a Bun-hosted local server over a bundled SPA.

The production work promotes this host into a signed Tauri application instead of replacing its serving model.

### Whispering already proves WebView-owned Yjs plus Rust artifacts

Whispering's current durable split stays intact for the first milestone:

```txt
Whispering SPA
  Yjs workspace
  IndexedDB persistence
  transcript rows, recipes, and settings

Rust/Tauri
  microphone samples
  <appDataDir>/recordings/<id>.wav
  local transcription
  shortcuts, overlay, clipboard, Accessibility
```

The recording pipeline writes metadata and transcripts through the SPA's Yjs workspace. Rust writes and fsyncs native audio artifacts. Bun does not need a Whispering workspace replica merely because it serves the SPA.

### The launcher prototype proved navigation identity

The prototype established that an app-specific launcher can cold-start or focus one real Epicenter host and open exactly one named window. Launchers remain optional navigation affordances after the host is production-ready.

## Target architecture

```txt
/Applications/Epicenter.app
|
|-- Tauri/Rust process
|   |-- bundle and TCC identity: so.epicenter.app
|   |-- single instance and deep-link routing
|   |-- spawn, monitor, and stop the Bun child
|   |-- create/focus/restore WebView windows
|   |-- microphone and recording engine
|   |-- local transcription and model cache
|   |-- global shortcuts and Accessibility
|   |-- clipboard, tray, overlay, autostart, updater
|   `-- focused Tauri commands and events
|
`-- compiled Bun application host
    |-- fixed production origin: http://127.0.0.1:39130
    |-- trusted SPA assets
    |   |-- /apps/query/
    |   |-- /apps/whispering/
    |   |-- /apps/mail/
    |   `-- /apps/books/
    |-- same-origin APIs and WebSockets
    |-- Query session and tool catalog
    |-- conversation workspace
    |-- Mail and Books services
    `-- later: trusted installed-SPA catalog
```

Every SPA is a top-level WebView document served by Bun. There is no bundled production SPA and no native-unprivileged SPA class.

## Stable application origin

### Production

The production origin is permanently:

```txt
http://127.0.0.1:39130
```

Rules:

- Bind exactly `127.0.0.1`, never `localhost`, `0.0.0.0`, `::`, or a LAN address.
- Do not read `PORT` or `EPICENTER_DEV_PORT` in a release build.
- Do not probe for another available port.
- Do not silently fall back if 39130 is occupied.
- Treat a bind collision as a native Retry/Quit startup failure.
- Treat any future scheme, host, or production-port change as a persisted-data migration.

Port 3913 is not used because IANA already assigns it to the ListCREATOR service. Ports 39130 and 39131 were unassigned in the IANA registry when this decision was made.

### Development

Development uses:

```txt
default:  http://127.0.0.1:39131
override: EPICENTER_DEV_PORT=<non-privileged port>
```

Rust resolves the development port once and passes it to Bun. Bun does not independently interpret the environment.

Changing the development port changes the browser origin. IndexedDB, localStorage, cookies, cache, BroadcastChannel, and service workers on the previous development port remain isolated there. The development log prints the resolved origin and warns when it differs from 39131.

Production and development never share an origin. This prevents development schema changes, cookies, service workers, or test data from touching production WebView state.

### Why the origin is persisted identity

IndexedDB follows the same-origin rule, and an origin includes scheme, host, and port. Paths do not split origin storage:

```txt
same origin:
  http://127.0.0.1:39130/apps/query/
  http://127.0.0.1:39130/apps/whispering/

different origin:
  http://127.0.0.1:39130/apps/whispering/
  http://127.0.0.1:39131/apps/whispering/
```

All trusted SPAs intentionally share the production origin. App workspace IDs and IndexedDB database names separate their data logically, not as a security boundary.

## Runtime startup

```txt
1. macOS launches Epicenter.app.
2. Rust becomes the single application instance.
3. Rust validates and queues any initial deep link.
4. Rust generates a cryptographically random per-launch credential.
5. Rust spawns the compiled Bun child.
6. Rust sends a versioned boot frame over stdin.
7. Bun binds 127.0.0.1:39130 in production or the resolved dev port.
8. Bun opens Query and required service state.
9. Bun prints one versioned readiness frame.
10. Rust validates the frame and opens the requested SPA WebView.
11. The SPA establishes its same-origin authenticated session.
12. Rust creates or focuses any queued surface window.
```

Suggested private frames:

```json
{"type":"boot","protocolVersion":1,"token":"<base64url>","port":39130}
{"type":"ready","protocolVersion":1,"port":39130}
```

Only stderr carries ordinary logs. An unknown protocol version, wrong port, invalid readiness frame, unexpected stdout preamble, or non-loopback bind fails startup.

### Startup failure

There is no bundled fallback SPA.

If Bun fails before readiness, Rust shows a native dialog with:

- Retry
- Reveal Logs
- Quit

Epicenter does not open a partially functional Whispering or Query window. This is the accepted consequence of one hosting mode.

## Runtime shutdown

Closing the last window does not quit Epicenter. Rust and Bun remain resident so global dictation and app services continue.

```txt
red close button
  -> close or hide visible windows
  -> Rust and Bun stay alive

Cmd+Q or menu-bar Quit
  -> stop new work
  -> flush SPA and Bun owners
  -> request Bun shutdown
  -> wait for bounded exit
  -> kill and reap as fallback
  -> quit Rust
```

If Bun crashes after startup, Rust closes or invalidates application WebViews and presents the native Retry/Quit failure surface. There is no promise that local dictation continues until Bun restarts.

## Trusted SPA model

All Epicenter SPAs are fully trusted code. This includes future installed SPAs.

Installation means the app may potentially access:

- Epicenter workspaces and same-origin browser storage
- native commands granted to trusted Epicenter WebViews
- microphone-backed recording through focused commands
- app-scoped filesystem artifacts through focused commands
- authenticated Bun APIs available to the shared origin

The eventual installer must say this plainly. It must not describe installed SPAs as sandboxed or independently permissioned. macOS grants TCC permission to Epicenter, not to each route or SPA.

V1 ships only release-bundled trusted SPAs. Dynamic installation, package manifests, signatures, catalog UI, and app updates remain deferred.

## Tauri remote authority

A Bun-served page is remote content from Tauri's perspective. Production must explicitly authorize the exact origin:

```json
{
  "identifier": "trusted-epicenter-apps",
  "windows": ["*"],
  "remote": {
    "urls": ["http://127.0.0.1:39130"]
  },
  "permissions": [
    "focused Epicenter command permissions"
  ]
}
```

Development uses a separate development configuration matching its resolved origin. A broad loopback pattern, if required for arbitrary `EPICENTER_DEV_PORT`, exists only in development.

Full trust collapses the per-surface capability taxonomy, but not command design. Rust still exposes focused commands such as:

```txt
start_recording
stop_recording
cancel_recording
transcribe_recording
prewarm_model
write_text
open_surface
```

Rust does not expose:

```txt
execute_native(name, payload)
execute_tool(name, payload)
proxy_http(request)
query_sql(sql)
spawn_process(command, args)
```

Every Rust command validates inputs. Full trust does not turn strings, filesystem paths, or process arguments from a WebView into trusted data.

## Loopback security

All SPAs and APIs share one origin, which removes cross-origin CORS plumbing. Loopback still needs authentication because other local processes can connect to port 39130.

Required controls:

- Use a fresh per-launch credential delivered to Bun over stdin, never argv.
- Bootstrap the trusted WebView session without placing the credential in server logs or durable browser storage.
- Require authentication before every API or WebSocket reaches domain code.
- Check `Host` against the exact active origin.
- Reject unexpected `Origin` and navigation away from the allowlisted loopback origin.
- Set a strict Bun-served CSP including Tauri IPC endpoints and only required external inference or sync origins.
- Never load scripts from arbitrary CDNs.
- Never persist the launch credential in IndexedDB, localStorage, Yjs, logs, crash reports, or URLs.
- Treat a process already listening on 39130 as a collision, never as a candidate Epicenter host.

The exact WebView bootstrap mechanism remains an implementation evidence question. Prefer an initialization-script or equivalent in-memory handoff over a query parameter. Prove it against the installed Tauri version before implementation commits to it.

## Surface and route model

The initial surface catalog is closed and compiled:

| Surface | URL | Window label | First milestone |
| --- | --- | --- | --- |
| Query | `/apps/query/` | `query` | Working existing Query surface |
| Whispering | `/apps/whispering/` | `whispering` | Working local dictation slice |
| Mail | `/apps/mail/` | `mail` | Placeholder |
| Books | `/apps/books/` | `books` | Placeholder |

Deep links remain strict:

```txt
epicenter://surface/query
epicenter://surface/whispering
epicenter://surface/mail
epicenter://surface/books
```

Unknown IDs, query strings, fragments, credentials, and extra path segments are rejected. Repeated opens focus the existing stable window label.

An app registry is not needed for V1. The static route table may later become the seed of an installed-app catalog, but implementation must not generalize it now.

## Runtime ownership

### Rust owns native mechanisms

Rust owns:

- application and TCC identity
- Bun child lifecycle
- windows and deep links
- microphone capture
- native audio artifacts
- local model cache and transcription
- global shortcuts
- Accessibility and clipboard delivery
- recording overlay
- tray, autostart, updater, and notifications

### Bun owns hosting and Bun-native services

Bun owns:

- every SPA response
- same-origin APIs and WebSockets
- Query session and tool catalog
- conversation persistence
- Mail and Books SQLite services when integrated
- eventual trusted installed-app files and catalog

Bun does not automatically own a SPA's Yjs workspace.

### Each SPA owns its WebView-local workspace when that is its honest store

Whispering keeps:

- `epicenter-whispering` Yjs workspace identity
- IndexedDB local persistence
- existing workspace sync connection
- recording rows and transcripts
- recipes and settings already modeled in the workspace

No Bun Whispering replica or local Yjs transport is built in the first milestone. Query cannot search Whispering history yet.

## Whispering clean-break absorption

Whispering becomes a trusted SPA and native subsystem inside Epicenter. It no longer ships as a separate full runtime after proof.

### No legacy-data migration

The release is a clean break:

- Do not read the old Whispering app-data directory.
- Do not open the old WebView origin or IndexedDB.
- Do not copy old auth, settings, recipes, shortcuts, or recordings.
- Do not create dual readers, dual writers, export handshakes, migration checkpoints, or rollback compatibility.
- Users grant microphone and Accessibility permission to Epicenter again.
- Users configure the new installation again.

A later ordinary audio-file import feature may accept standard media. It is not a Whispering migration system.

### First functional slice

Transplant the existing functional UI into `/apps/whispering/` with minimal visual redesign. Preserve one complete local path:

```txt
global shortcut
  -> Rust microphone recording
  -> Rust writes WAV artifact
  -> local Rust transcription
  -> SPA writes transcript row to Yjs
  -> IndexedDB persists the row
  -> clipboard or cursor delivery
```

Defer cloud transcription, polishing, recipes beyond what transplants trivially, VAD, bulk import, Query history tools, agent-started microphone capture, and legacy migration.

### General native capability

The transcription engine belongs to Epicenter, not to the Whispering route. Any trusted SPA may call focused recording and transcription commands. Whispering remains the product surface for history, dictation configuration, and the full workflow.

The Bun process itself cannot call Tauri `invoke`. Agent-initiated native actions remain refused. If later required, design a narrow parent-child capability protocol or a focused local approval flow. Do not add a generic Bun-to-Rust executor in this milestone.

## Query, Mail, and Books

### Query

Rename Super Chat to Epicenter Query without compatibility aliases. Preserve the existing Bun-hosted session and command vocabulary. Query is one SPA and one Bun service inside Epicenter, not the desktop host itself.

### Mail and Books

The first milestone ships placeholder SPAs at their final routes. Later waves move their existing Bun/SQLite services and UI into the same host.

Mail and Books should eventually dogfood the same trusted SPA hosting contract intended for future installed apps. Do not add a running-app bridge, separate GUI process, or standalone updater.

## First milestone

The milestone proves the host topology, not the whole product inventory.

```txt
Epicenter.app
  fixed Bun origin on 39130
  trusted remote Tauri authority
  working Query SPA
  transplanted Whispering SPA
  local recording and transcription
  Yjs/IndexedDB transcript persistence
  native WAV persistence
  global shortcut while windows are closed
  Mail placeholder
  Books placeholder
```

The milestone explicitly excludes:

- dynamic installed apps
- app registry and package format
- Books production integration
- Mail production integration
- Bun Whispering replica
- Query access to Whispering history
- Bun-initiated native actions
- legacy Whispering migration
- production redesign of Whispering

## Implementation waves

### Wave 0: Durable decision gate

- [x] Write a Proposed ADR for one trusted Bun-hosted SPA origin.
- [x] Record full installed-SPA trust and no Bun-independent mode.
- [x] Record production 39130 and development 39131 as origin identity.
- [x] Record the Whispering clean break and no legacy migration.

### Wave 1: Promote Super Chat to Epicenter

- [x] Rename `apps/super-chat` to `apps/epicenter` without aliases.
- [x] Add the Tauri crate and `so.epicenter.app` identity.
- [x] Preserve Bun SPA/API/WebSocket serving.
  > **Note:** Query now lives only at `/apps/query/`; its API and WebSocket are
  > namespaced under `/api/query/`. Tauri will exchange the launch credential
  > for an HttpOnly same-site browser session at `/_epicenter/bootstrap`.
- [x] Bind production to 39130 and development to 39131 or `EPICENTER_DEV_PORT`.
- [x] Add exact single-instance, readiness, shutdown, and collision behavior.
  > **Checkpoint:** Bun now accepts one strict versioned boot frame, validates
  > the Rust-supplied production or development port, emits one versioned ready
  > frame, fails a collision without fallback, and exits cleanly on signal or
  > parent-pipe EOF. Rust port resolution, supervision, and single-instance
  > ownership remain in this wave.
- [x] Open Query from the Bun origin in a Tauri WebView.
- [ ] Prove a Bun-served trusted page can call one harmless focused Rust command.
  > **Checkpoint:** The remote capability, generated `get_runtime_info`
  > permission, and live Bun-served invoke call are wired. Visual confirmation
  > remains open until the locked macOS session is available to Computer Use.

### Wave 2: Surface routing

- [x] Add the closed Query, Whispering, Mail, and Books route table.
- [x] Add strict deep links and stable create-or-focus window labels.
- [x] Add placeholder Mail and Books SPAs.
- [ ] Prove cold, warm, repeated, minimized, hidden, and Spaces behavior.
  > **Checkpoint:** Cold Books launch and repeated warm Mail, Books, and
  > Whispering deep links preserve one Rust instance and one Bun child. The
  > minimized, hidden, Spaces, and visible-window proof remains open until the
  > locked macOS session is available to Computer Use.

### Wave 3: Transplant Whispering native mechanisms

- [ ] Move the recorder, audio, transcription, shortcut, clipboard, overlay, and permission modules into Epicenter Rust.
- [ ] Move required Cargo dependencies, resources, entitlements, and usage descriptions.
- [ ] Preserve focused command names and generated bindings where practical.
- [ ] Add fresh Epicenter microphone and Accessibility onboarding.
- [ ] Do not generalize the Rust modules during the move.

### Wave 4: Transplant the Whispering SPA

- [ ] Serve the existing functional Whispering UI at `/apps/whispering/`.
- [ ] Preserve its WebView-owned Yjs/IndexedDB workspace.
- [ ] Preserve native artifact-by-ID handling.
- [ ] Replace Whispering-specific app, window, tray, and navigation assumptions.
- [ ] Prove the complete local dictation path.
- [ ] Leave old standalone source on disk but stop importing it.

### Wave 5: Prove and delete

- [ ] Run every milestone verification gate with old paths unimported.
- [ ] Test a production `.app` from `/Applications`.
- [ ] Use Computer Use for visible window, Dock, menu-bar, permission, and shortcut evidence.
- [ ] Delete the old standalone Super Chat identity and Whispering runtime only after proof.
- [ ] Keep Mail and Books production work for later specs.

## Verification

### Origin and startup

- Production binds only `127.0.0.1:39130`.
- Development defaults to 39131 and honors `EPICENTER_DEV_PORT`.
- Production ignores every port override.
- A 39130 collision produces native Retry/Quit and no fallback port.
- Restarting production returns to the exact same origin.
- Dev and production can run simultaneously without sharing browser storage.

### Tauri authority

- The Bun-served Whispering SPA can invoke focused recording and transcription commands.
- An ordinary external browser receives no Tauri IPC bridge.
- Navigation away from the allowlisted origin loses native authority or is blocked.
- Rust rejects malformed IDs, paths, model selections, and command inputs.
- No generic command executor exists.

### Whispering persistence

- A global shortcut starts one recording.
- Stopping writes one WAV under Epicenter app data.
- Local transcription completes and writes one Yjs recording row.
- Closing and reopening the Whispering window preserves the row and playback.
- Quitting and relaunching Epicenter reloads the row from the same IndexedDB origin.
- The WAV remains playable after relaunch.
- Deleting the recording removes the Yjs row and native artifacts.
- Changing only the SPA path does not change persistence.
- Changing the development port yields intentionally separate development storage.

### Residence and failure

- Closing every window leaves Rust, Bun, tray, and global shortcut active.
- Reopening Whispering focuses one window and does not mount duplicate shortcut owners.
- Cmd+Q stops Bun and leaves no orphan process.
- Forced Rust termination does not leave Bun resident.
- Bun failure closes or invalidates SPAs and presents native Retry/Quit.
- Restarting Bun on the same origin restores the application and IndexedDB visibility.

### Query and placeholders

- Existing Query behavior survives the product rename.
- Query and Whispering can be open simultaneously.
- Mail and Books deep links open exactly one placeholder window each.
- No Mail, Books, or Whispering running-app bridge exists.

### Installed production bundle

- The signed development or release bundle runs from `/Applications`.
- TCC prompts name Epicenter.
- Dock, Cmd-Tab, menu bar, and tray identity settle on Epicenter.
- Spotlight and launchers route to the correct surface.
- Full update packaging keeps Rust, Bun, and release-bundled SPA assets compatible.

## Complexity deleted

This direction removes:

- bundled-SPA production mode
- Bun-independent feature mode
- bundled versus hosted trust classes
- sandboxed installed-SPA permissions
- per-surface native capability taxonomy
- cross-origin UI-to-Bun CORS
- runtime Bun-origin bootstrap for a bundled UI
- dynamic production ports
- fallback-port behavior
- production IndexedDB origin churn
- Whispering legacy migration
- separate Super Chat and Whispering desktop releases
- running-app bridges for built-in surfaces

## Complexity accepted

The host still owns:

- one fixed loopback-port collision failure
- Bun child startup and shutdown
- authentication against other local processes
- trusted remote Tauri capability configuration
- strict CSP and navigation policy
- a larger shared failure and security blast radius
- honest full-trust installation UX when dynamic apps arrive
- future app authenticity and update verification

These are the direct cost of one trusted application host, not compatibility scaffolding.

## Explicit refusals

### Refuse a bundled fallback SPA

User loss: Epicenter cannot operate while Bun is down.

Deletion prize: no second UI origin, recovery router, reduced feature mode, or duplicate asset build.

### Refuse sandboxed installed apps

User loss: installing an SPA means granting Epicenter-level trust.

Deletion prize: no extension sandbox, permission broker, native mediation layer, or misleading per-app TCC model.

### Refuse production port fallback

User loss: a process occupying 39130 blocks startup until resolved.

Deletion prize: stable IndexedDB, cookies, capability origin, CSP, and browser identity without migration or discovery.

### Refuse Whispering legacy migration

User loss: old local history and configuration stay in the old app.

Deletion prize: no old-origin reader, export handshake, dual storage, restartable migration, or compatibility release.

### Refuse Bun ownership of Whispering Yjs in milestone one

User loss: Query cannot search Whispering history yet.

Deletion prize: no second replica, local Yjs transport, persistence-owner rewrite, or data API during the native transplant.

### Refuse agent-started microphone capture

User loss: the Query agent cannot start recording.

Deletion prize: no Bun-to-Rust native protocol, approval grant, remote microphone policy, or three-runtime request lifecycle.

## Decisions requiring an ADR

The Proposed ADR must record:

- Super Chat becomes Epicenter Query inside one desktop host.
- Bun serves every production SPA.
- All release-bundled and future installed SPAs are fully trusted.
- Tauri grants the exact Bun origin remote native authority.
- Production origin is `http://127.0.0.1:39130` and does not fall back.
- Development defaults to 39131 and may use `EPICENTER_DEV_PORT`.
- No part of Epicenter operates without Bun.
- Whispering retains WebView Yjs/IndexedDB persistence for the first milestone.
- The clean-break release performs no old Whispering data migration.

ADR-0084 should be promoted rather than reversed. ADR-0080 should be sharpened from Query host to trusted application host. ADR-0113 remains: the Query session has one Bun-owned command vocabulary. ADR-0116 changes only when Mail's real service moves into Epicenter.

## Deferred decisions

- Trusted installed-SPA package format and catalog
- App authenticity and update verification
- Bun Whispering workspace replica for Query history access
- Bun-to-Rust capability protocol for agent-initiated native actions
- Mail production integration
- Books production integration
- Thin launcher packaging
- Windows and Linux parity timing

## Research references

- [Tauri capabilities](https://v2.tauri.app/security/capabilities/)
- [Tauri runtime authority](https://v2.tauri.app/security/runtime-authority/)
- [Tauri CSP](https://v2.tauri.app/security/csp/)
- [Tauri sidecars](https://v2.tauri.app/develop/sidecar/)
- [Tauri deep linking](https://v2.tauri.app/plugin/deep-linking/)
- [Tauri single instance](https://v2.tauri.app/plugin/single-instance/)
- [MDN same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy)
- [MDN IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)
- [IANA service-name and port registry](https://www.iana.org/assignments/service-names-port-numbers/service-names-port-numbers.xhtml)
- [Apple TN3127: code-signing requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)
- [Apple media capture authorization](https://developer.apple.com/documentation/bundleresources/requesting-authorization-for-media-capture-on-macos)

## Stop condition

The first milestone is complete when an installed Epicenter bundle boots its trusted Bun origin on 39130, opens working Query and Whispering SPAs, invokes moved Rust recording and transcription commands from the Bun-served Whispering WebView, persists transcript rows through WebView Yjs/IndexedDB and WAVs through Rust, keeps dictation active after all windows close, and shuts down without an orphaned Bun child.

Stop before Mail or Books production integration, dynamic installed apps, a Bun Whispering replica, agent-initiated microphone capture, an ADR acceptance flip, or any legacy Whispering data migration.
