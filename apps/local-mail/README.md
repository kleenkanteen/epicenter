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

Connect once:

```sh
infisical run --env=dev --path=/apps/local-mail -- \
  bun run src/bin.ts connect
```

Use `--client-id <id>` to override `GMAIL_CLIENT_ID` for the connect command.
`GMAIL_CLIENT_SECRET` is still required because Google Desktop clients have a
secret and the token exchange sends it as a form parameter.

Local Mail requests `gmail.modify` so write-through label changes can round-trip
through Gmail. Older tokens minted with the previous read-only scope can still
read and sync; the first write will ask you to run `local-mail connect` again.
Although Google grants send at the same OAuth layer, Local Mail does not expose
send, reply, compose, drafts, trash, untrash, or delete in this phase.

Headless bootstrap is still available. The refresh token is redeemed
immediately (one refresh grant plus a profile read), so a dead token fails
here rather than on the first sync, and the account email comes from the
Gmail profile instead of being typed:

```sh
infisical run --env=dev --path=/apps/local-mail -- \
  bun run src/bin.ts seed-token <refresh-token>
```

Build or refresh the mirror:

```sh
infisical run --env=dev --path=/apps/local-mail -- \
  bun run src/bin.ts sync --full

infisical run --env=dev --path=/apps/local-mail -- \
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

## Config

- `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET`: Google OAuth Desktop client keys.
- `LOCAL_MAIL_ACCOUNT`: optional account override for `sync`, `query`, and
  `mcp`. Required only when more than one account is connected.
- `LOCAL_MAIL_DIR`: data directory override.
- `LOCAL_MAIL_TOKEN_FILE`: token file override.
- `LOCAL_MAIL_GMAIL_API_BASE`: test plumbing only; points the Gmail client at
  a mock server in the MCP subprocess test.

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

- CLI, MCP, HTTP, and UI surfaces for Gmail write-through actions such as
  archive, mark-read, and label edits.
- Send, reply, compose, drafts, trash, untrash, and permanent delete.
- FTS5. `LIKE` over `body_text` is enough for the current mirror size.
- Push/Pub/Sub.
- The `up` local server and UI.
