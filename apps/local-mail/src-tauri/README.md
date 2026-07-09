# local-mail desktop shell

The smallest native wrapper around the Bun mail engine (`local-mail app`). It
owns the window and the child engine's lifetime, and nothing else. Gmail OAuth,
token refresh, sync, the SQLite mirror, and the loopback API bearer all stay in
Bun end to end (ADR-0116). Rust never sees a Gmail token or the bearer.

## How it works

1. `setup()` spawns `bun src/bin.ts app` from the engine package dir.
2. The engine prints the loopback origin it serves (`http://127.0.0.1:<port>`)
   to stdout, once, only after it is listening. That single line is both the
   discovery signal (which port) and the readiness signal (it is up).
3. The shell opens a `WebviewUrl::External` window at that origin. The engine's
   own response headers (frame-deny, `no-store`, CSP) are the security boundary;
   Tauri does not inject CSP into external pages, and the webview never calls
   `invoke()`, so the shell registers no commands and needs no remote-IPC
   allowlist.
4. Closing the window quits the app, which kills the engine (`RunEvent::Exit`).
   The engine never outlives the window: no background mail service (ADR-0116).

This is the ADR-0084 sidecar recipe (spawn the engine, read the port from
stdout, point a window at it), the pattern that spec named for the Tauri wrap.

## Run it (dev)

Prerequisites: `bun` on PATH, and the UI built once so the engine has something
to serve:

```sh
bun run --cwd apps/local-mail/ui build
```

Then, from `apps/local-mail`:

```sh
bun run app:desktop      # == tauri dev: cargo runs the shell, which spawns the engine
```

A connected account is required (`bun run src/bin.ts connect` once). The shell
opens no window until the engine reports its origin, so a blank moment at launch
is the engine starting, not a hang. Watch the terminal for `[sync ...]` and the
`listening on http://127.0.0.1:...` hint.

Only `bun` is called: no port is pinned, so this never collides with a separate
`local-mail app` you already have open (that instance keeps the sync lock; this
one serves reads, both under their own ephemeral origins).

## Not wired yet (the packaging wave)

This shell is proven via `tauri dev`. A distributable `.app`/`.exe` is the
deferred packaging wave, blocked on:

- **Compiled sidecar.** A packaged app cannot spawn `bun src/bin.ts` from a
  source dir (`CARGO_MANIFEST_DIR` is a build-machine path, and `bun` may not be
  on the end user's PATH). The engine must ship as a `bun build --compile`
  binary registered as a Tauri sidecar (`bundle.externalBin`), and `spawn_engine`
  must switch from `bun src/bin.ts app` to the resolved sidecar path in release
  builds. The compile-embed of the SPA into that binary is the engine-side half
  (see the `up` spec's distribution wave; embedded-manifest codegen is proven).
- **Icons + `bundle.active: true`.** `bundle.active` is `false` here; packaging
  needs the icon set and signing/notarization config (see `apps/honeycrisp`).
- **Graceful engine shutdown.** Exit kills the engine with SIGKILL, which is
  safe by design (the sync lock is a kernel-released fcntl lock; presence is
  stale-safe). A SIGINT/SIGTERM path (so the engine clears its presence file and
  releases the lock cleanly) is a nice-to-have, not a correctness gate.
- **Orphan on hard kill.** If `tauri dev` itself is SIGKILLed, the engine is
  reparented and keeps running (holding the sync lock). Harmless and self-healing
  (the lock is crash-safe; the next launch or a manual `kill` clears it), but
  worth a parent-death watchdog if it ever bites.
