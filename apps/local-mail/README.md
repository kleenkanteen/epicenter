# local-mail

Headless Gmail CDC mirror: syncs a Gmail account into a local SQLite database
via full pull + incremental `history.list` polling. Ports `apps/local-books`'
mirror/CDC/OAuth shape onto Gmail; see that package's `AGENTS.md` for the
pattern this is modeled on.

**Phase 1 only** (mirror core, no UI, no writes, no interactive OAuth flow).
Design authority: `docs/adr/0081-*.md`, `docs/adr/0082-*.md`,
`specs/20260630T150000-local-mail-tauri-cdc-mirror.md` and its `.handoff.md`.

## Shape

- Runtime: Bun. `bun:sqlite` for storage, built-in `fetch` for the Gmail API,
  `oauth4webapi` for the refresh-token grant.
- One SQLite file per connected account: `<data-dir>/<accountEmail>/mail.db`.
  The refresh token lives in a separate `0600 credentials.json` at the
  data-dir root, never inside the mirror db (ADR-0062's reasoning, ported).
- Three fixed tables (`messages`, `threads`, `labels`) plus `_meta` (the
  `history_id` cursor). See `src/db.ts`'s top comment for how this adapts
  `apps/local-books`' entity-registry shape to Gmail's fixed, non-uniform
  entities, and for the `labelPatch` vs `upsert` distinction `history.list`'s
  four record types require.

## Manual verification (Phase 1 has no connect flow yet)

A refresh token has to come from somewhere until Phase 2 ships the PKCE +
loopback-callback connect flow. Obtain one out of band (e.g. Google's OAuth
Playground, or a throwaway script per the spec's Phase 0), then:

```sh
infisical run --env=dev --path=/apps/local-mail -- \
  bun run src/bin.ts seed-token you@example.com <refresh-token>

LOCAL_MAIL_ACCOUNT=you@example.com \
infisical run --env=dev --path=/apps/local-mail -- \
  bun run src/bin.ts sync --full
```

Subsequent `sync` calls (no `--full`) run incrementally against the stored
`history_id` cursor.

## Config (env)

- `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` — the Desktop-type OAuth client
  Infisical injects at `/apps/local-mail`.
- `LOCAL_MAIL_DIR` — data directory override.
- `LOCAL_MAIL_TOKEN_FILE` — override the token file path.
- `LOCAL_MAIL_ACCOUNT` — which account `sync` operates on.

## Testing

`bun test` covers `decideMode` (pure), the mirror's ingest/patch/soft-delete
behavior (`db.test.ts`, real `bun:sqlite` against a temp file), and
`syncMailbox` end to end against a hand-rolled in-memory fake `GmailClient`
(`sync-mailbox.test.ts`) rather than an HTTP mock server: Phase 1 has three
fixed endpoints and no pagination-heavy entity registry the way
`apps/local-books`' mock QB server earns, so a fake satisfying the
`GmailClient` interface directly is enough to exercise the FULL/INCREMENTAL
paths and the `history.list` record-folding logic.

## Not built yet

- Phase 2: the interactive connect flow (PKCE + loopback callback, both
  hosted and self-host `clientId` modes).
- Phase 3: write-through actions (archive/label) + reconciliation.
- Phase 4: the Tauri shell and UI.

See the handoff doc for the open questions the owner still needs to resolve
(cross-device token sync via the secret vault, default poll interval) and for
why the actual Tauri/SQLite-driver question was deliberately deferred rather
than guessed at when this package was scaffolded.
