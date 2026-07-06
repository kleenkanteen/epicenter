# local-mail

Headless Gmail mirror for local tools and agents. It syncs a Gmail account into
a private SQLite database with full pulls plus incremental `history.list`
polling, then exposes the mirror through CLI queries and a stdio MCP server.

Design authority lives in ADRs first: `docs/adr/0081-*.md`,
`docs/adr/0082-*.md`, `docs/adr/0087-*.md`, then the current code. The mirror is
Gmail-owned cache data. Human-meaningful mail state must round-trip through
Gmail, not a local-only table.

## Shape

- Runtime: Bun. `bun:sqlite` stores the mirror, built-in `fetch` calls Gmail,
  `oauth4webapi` handles OAuth.
- One SQLite file per connected account: `<data-dir>/<accountEmail>/mail.db`.
  The refresh token lives in a separate `0600 credentials.json` at the data-dir
  root, never inside the mirror db.
- Data and account directories are `0700`. `mail.db`, `mail.db-wal`,
  `mail.db-shm`, and `credentials.json` are `0600`.
- Tables: `messages`, `labels`, and `_meta`. Thread facts are derived from live
  messages instead of stored in a separate `threads` table.
- `messages.body_text` is decoded at ingest from `text/plain` MIME parts, with
  stripped `text/html` as a fallback. That makes SQL and MCP useful for body
  questions without adding FTS yet.

## Commands

Connect once. `--gmail-env` picks the OAuth keyset: `dev` reads `GMAIL_DEV_*`
(the unverified client), `prod` reads `GMAIL_PROD_*` (the verified one). It is
required only when both keysets are present, and inferred when just one is. The
account records the environment it was connected under, and every later sync
asserts it (ADR-0108):

```sh
infisical run --path=/apps/local-mail -- \
  bun run src/bin.ts connect --gmail-env dev
```

The name carries the provider target. The app-local Infisical config should
point at your personal secrets project, where both keysets sit under
`prod /apps/local-mail` for a single injection. This is per-person
bring-your-own provider configuration, not Epicenter-hosted infrastructure. Copy
`.infisical.json.example` to `.infisical.json` and keep the real file local.
That file is ignored because each operator has a different personal Infisical
project. The committed `apps/api` and `ops` configs point at Epicenter's hosted
project instead. See [`.env.example`](.env.example) for the canonical names. The
old unqualified `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` are retired.

Local Mail requests `gmail.modify` so write-through label changes can round-trip
through Gmail. Although Google grants send at the same OAuth layer, Local Mail
does not expose send, reply, compose, drafts, trash, untrash, or delete in this
phase.

Headless bootstrap is still available. The refresh token is redeemed
immediately (one refresh grant plus a profile read), so a dead token fails
here rather than on the first sync, and the account email comes from the
Gmail profile instead of being typed:

```sh
infisical run --path=/apps/local-mail -- \
  bun run src/bin.ts seed-token <refresh-token> --gmail-env dev
```

Build or refresh the mirror:

```sh
infisical run --path=/apps/local-mail -- \
  bun run src/bin.ts sync --full

infisical run --path=/apps/local-mail -- \
  bun run src/bin.ts sync --watch
```

Check connection and mirror state:

```sh
bun run src/bin.ts status
```

Query the mirror:

```sh
bun run src/bin.ts query "SELECT subject, sender FROM messages ORDER BY internal_date DESC LIMIT 10"
```

Triage messages. Each verb is a Gmail label change that the mirror folds in
after Gmail accepts it. Output is human-readable; add `--json` for the typed
`ModifyMessageLabelsOutcome` that MCP and the `app` HTTP API share.

```sh
bun run src/bin.ts archive <id...>
bun run src/bin.ts unarchive <id...>
bun run src/bin.ts mark-read <id...>
bun run src/bin.ts mark-unread <id...>
bun run src/bin.ts label <id...> --add Work --remove Promotions
```

`archive`, `mark-read`, and friends are the triage vocabulary; `label` is the
transparent primitive they desugar to (`archive` is `label --remove INBOX`).
Any per-id rejection or a systemic abort exits nonzero, so
`mark-read <id> && next` never proceeds on a mailbox that did not change.
`LOCAL_MAIL_READ_ONLY` refuses every write while leaving `query`/`status`/`sync`
available.

Serve the triage UI and its API from one loopback process:

```sh
bun run src/bin.ts app
```

`app` runs the sync loop and serves the triage SPA (`ui/`) plus a same-origin
`/api` on `127.0.0.1`, then prints `http://127.0.0.1:PORT/#token=...` and opens
it. The tab is the app. Security is the loopback shell spec's: a single-use bootstrap
token rides in the URL fragment and is exchanged once at `POST /api/session`
for a per-launch session bearer (kept in sessionStorage); every request is
Host-checked first; the write route is the one `POST /api/messages/modify`
(`{ ids, addLabels, removeLabels }` -> `ModifyMessageLabelsOutcome`) over the
same core the CLI verbs and MCP tool use, so archive/read/label all desugar to
add/remove sets client-side. `LOCAL_MAIL_READ_ONLY` disables writes end to end;
`--no-open` prints the URL without launching a browser. `--port <n>` pins the
server port. `LOCAL_MAIL_NO_OPEN=1` and `LOCAL_MAIL_PORT` remain env fallbacks.

Develop the UI against a running `app`:

```sh
LOCAL_MAIL_DEV=1 LOCAL_MAIL_TOKEN=devtoken LOCAL_MAIL_PORT=4177 bun run src/bin.ts app
LOCAL_MAIL_TOKEN=devtoken bun run --cwd ui dev   # same token: Vite proxies /api to app, injecting this bearer
```

Serve tools to an MCP host:

```sh
bun run src/bin.ts mcp
```

When more than one account is connected, set `LOCAL_MAIL_ACCOUNT` to choose
which mirror `sync`, `query`, and `mcp` should use.

Tools:

- `query`: read-only SQL over the mirror, capped at 1000 returned rows.
- `status`: account, cursor, and row counts.
- `sync`: one local mirror refresh pass. This writes only the local cache.
- `modify_labels`: add or remove Gmail labels on 1 to 100 messages by id or
  exact name (`addLabels`/`removeLabels`), then fold Gmail's response. Per-id
  rejections ride inside the structured result; only a systemic abort sets
  `isError`. Unlisted under `LOCAL_MAIL_READ_ONLY`. The CLI triage verbs above
  are the human-facing form of this one tool.

## Config

- `GMAIL_DEV_CLIENT_ID` / `GMAIL_DEV_CLIENT_SECRET`, `GMAIL_PROD_CLIENT_ID` /
  `GMAIL_PROD_CLIENT_SECRET`: the Google OAuth Desktop client keys, one keyset per
  environment (ADR-0108). `--gmail-env` selects which the resolver reads, lazily at
  connect/refresh; a missing keyset fails loudly naming the exact variables.
- `LOCAL_MAIL_ACCOUNT`: optional account override for `sync`, `query`, and
  `mcp`. Required only when more than one account is connected.
- `LOCAL_MAIL_DIR`: data directory override.
- `LOCAL_MAIL_TOKEN_FILE`: token file override.
- `LOCAL_MAIL_GMAIL_API_BASE`: test plumbing only; points the Gmail client at
  a mock server in the MCP subprocess test.
- `LOCAL_MAIL_PORT`: fallback for pinning the `app` server port; prefer
  `--port <n>` for normal use.
- `LOCAL_MAIL_DEV` / `LOCAL_MAIL_TOKEN`: dev-mode `app`; the Vite proxy injects
  the fixed bearer. The bearer gate is never disabled in any mode.
- `LOCAL_MAIL_NO_OPEN`: fallback for making `app` print the launch URL without
  opening a browser; prefer `--no-open` for normal use.

## Testing

Run from this package:

```sh
bun test
bun run typecheck
```

The tests use real `bun:sqlite` temp files for DB behavior, a fake
`GmailClient` for sync folding, mock HTTP endpoints for OAuth, and a real MCP
stdio subprocess for the agent-facing protocol surface.

## Not built yet

- HTML mail-body rendering. The detail pane shows the pre-extracted plain-text
  body; rich HTML rendering (the sanitizer + sandboxed srcdoc + CSP + show-images
  proxy) is deferred, which is why the SPA has no mail-body iframe yet.
- Compile-embed distribution (`bun build --compile`) and the Tauri wrapper. `app`
  serves `ui/dist` from disk; the route table is the seam the distribution wave
  swaps for embedded assets later.
- Send, reply, compose, drafts, trash, untrash, and permanent delete.
- Thread-level modify and `messages.batchModify`. Triage is message-level.
- FTS5. `LIKE` over `body_text` is enough for the current mirror size.
- Push/Pub/Sub and any LAN or remote exposure (the server binds `127.0.0.1`).
