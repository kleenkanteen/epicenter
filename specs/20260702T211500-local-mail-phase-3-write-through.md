# Local Mail Phase 3: write-through label mutations

**Date**: 2026-07-02
**Status**: Draft
**Owner**: Braden
**Relates**: ADR-0082 (writes hit Gmail first; the mirror folds the result in after), ADR-0098 (`docs/adr/0098-local-mail-state-round-trips-through-gmail.md`: every human-actionable concept round-trips through Gmail API state), ADR-0073 (MCP effect tiers; the host's approval prompt is the interactive trust boundary), `specs/20260630T150000-local-mail-tauri-cdc-mirror.md` (parent spec; its Phase 3 scope re-homes here), `specs/20260701T141500-local-mail-up-bun-served-shell.md` (Phase D consumes these cores; UI is downstream of this spec's stop point)

## One Sentence

Phase 3 gives Local Mail its first Gmail writes: six product actions (mark read/unread, archive/unarchive, add/remove label) that all collapse to one `messages.modify` core which mutates Gmail first, folds Gmail's authoritative response into the mirror, and lets the existing history sync reconfirm; SQLite never originates mail state.

## The product rule

A Local Mail write is a Gmail mutation that the mirror learns about, never a mirror mutation that Gmail learns about.

```txt
Tool call
  -> messages.modify (Gmail accepts or rejects)
  -> fold Gmail's response labelIds into the mirror row (best-effort)
  -> next history.list pass reconfirms
```

## How to read this spec

Read first: One Sentence, Accepted actions, Architecture, Implementation waves, Stop point.
Read if changing the design: Research findings (the verified/unverified API facts), Design decisions, Failure model.
Read before exposing anything new over MCP: Trust boundary.

## Current state

The Phase 2 engine (merged, PR #2287) is read-only end to end:

- `gmail-client.ts` speaks only GET: `messages.list/get`, `history.list`, `labels.list`, `getProfile`. `request()` (`gmail-client.ts:147`) has no method or body parameter.
- The OAuth scope is hardcoded to `gmail.readonly` (`oauth.ts:91`).
- The mirror's only writer is `sync.ts` through `MailDb` (`ingestFullPullPage`, `applyHistoryBatch`, `ingestLabels`, `finishFullPull`). ADR-0098's consequences name "the write-through cores" as the mirror's only future co-writer.
- MCP (`mcp.ts`) exposes `query`, `status`, `sync` with a two-value `tier: 'read' | 'write'` that maps to `readOnlyHint` and a hardcoded `destructiveHint: false` (`mcp.ts:181-183`). Nothing gates on it.
- The repo already has one proven write-through core: `apps/local-books/src/books/recategorize.ts`. Its shape (required no-default `readOnly` argument, upstream-first mutation, best-effort fold of the authoritative response, honest `folded: boolean`) is the port target.

## Accepted Phase 3 actions

Six product actions, one implementation primitive. Every action is a reversible label-set operation on a message; Gmail's own API grain (`messages.modify` with `addLabelIds`/`removeLabelIds`) is the only call any of them make.

| Action | Gmail mutation | Notes |
| --- | --- | --- |
| Mark read | remove `UNREAD` | |
| Mark unread | add `UNREAD` | |
| Archive | remove `INBOX` | message-level; thread-level is deferred (see below) |
| Unarchive | add `INBOX` | |
| Add label | add `<labelId>` | label must already exist in Gmail; `labels.create` is deferred |
| Remove label | remove `<labelId>` | |

`UNREAD`, `INBOX`, and `STARRED` are documented as manually applicable system labels; `DRAFT` and `SENT` are documented as not manually applicable. Phase 3 does not maintain a local blocklist: Gmail rejects unapplicable labels with a 400, and Gmail owning the rejection is the point.

## Refused and deferred

| Item | Verdict | Why |
| --- | --- | --- |
| Snooze, send-later, local folders, local-only tags, any hidden state | Refused | ADR-0098; do not re-litigate here |
| Send, reply, compose, drafts | Deferred | Gmail-expressible (ADR-0098 allows drafts), but send is irreversible and needs its own trust design (`destructiveHint: true`, probably a confirmation posture). Note: once the app holds `gmail.modify`, send is already granted at the OAuth layer (verified; see Research findings), so this deferral is an app-level product refusal, not a scope boundary. Revisit as its own phase. |
| `labels.create` | Deferred | ADR-0098 explicitly allows it; Phase 3 only applies labels that already exist. Revisit when: the first real workflow wants to apply a not-yet-existing tag. |
| Thread-level modify | Deferred | `threads.modify` is verified (10 quota units, applies add/remove to all messages in the thread at request time), so the follow-up is cheap. Message-level first keeps the fold and failure model per-row. Revisit when: the shell spec's Phase C/D thread UI makes per-message loops awkward. |
| `messages.batchModify` | Deferred | Verified: max 1000 ids, flat 50 units, but the success response is empty, atomicity is undocumented, and per-message failure reporting definitively does not exist. No response means nothing to fold and no honest per-id errors. Revisit when: a real workflow needs >100 ids per call or quota pressure appears. |
| Trash / untrash / delete | Deferred, with one eyes-open caveat | The `messages.trash`/`untrash` vocabulary and permanent delete (which needs the full `mail.google.com` scope) wait for a destructive-confirmation posture. Caveat, chosen knowingly: because `TRASH` and `SPAM` are documented client-addable labels and Phase 3 keeps no local blocklist, `modify_labels` with `addLabelIds: ["TRASH"]` will succeed. That is accepted for Phase 3: a trash label move is reversible for ~30 days (so `destructiveHint: false` stays honest under MCP's irreversibility definition), and the deferral covers the sugar verbs, the confirmation posture, and permanent delete, not the raw capability. Flip to a local `TRASH`/`SPAM` carve-out only as a deliberate owner decision, since it would breach the "Gmail owns rejection" model. |
| Bulk workflows (query-then-act sweeps, rules) | Deferred | Composable from the primitive by the calling agent; nothing to build here yet. |

## Research findings (verified 2026-07-02 against official Gmail docs)

Google now serves these under `developers.google.com/workspace/gmail/...`; old URLs redirect.

| Fact | Value | Status |
| --- | --- | --- |
| `messages.modify` body | `{ addLabelIds[], removeLabelIds[] }`, max 100 each per call | Documented |
| `messages.modify` response | "an instance of Message"; the observed slim shape (`id`, `threadId`, `labelIds`, no payload) is community knowledge | Response-is-Message documented; which fields populate is NOT contractual |
| System labels a client may add/remove | `INBOX`, `UNREAD`, `STARRED`, `IMPORTANT`, `SPAM`, `TRASH`, `CATEGORY_*`; never `DRAFT`/`SENT` | Documented |
| `batchModify` | max 1000 ids, empty success response, no atomicity promise, no per-message errors | Documented (the gaps are the documentation) |
| `threads.modify` | exists; same 100-label caps; applies to all messages in the thread; returns a Thread | Documented |
| Own writes appear in `history.list` | "Lists the history of all changes to the given mailbox"; no same-client exclusion | Confirmed by plain reading |
| History propagation latency | a change took ~2.5 to ~8 minutes to appear in `history.list` | Measured live, Phase 0 (parent spec, First slice) |
| Quota | 6,000 units/min/user (the old 250 units/sec figure is stale); `messages.modify` = 5, `threads.modify` = 10, `batchModify` = 50 flat, `labels.list` = 1 | Documented |
| Minimal scope for message label mutations | `gmail.modify` (Restricted). `gmail.labels` covers only `labels.*` CRUD, NOT `messages.modify`. No scope grants modify without also granting send. | Documented |
| Verification class change | None: `gmail.readonly` and `gmail.modify` are both Restricted, so the readonly-to-modify flip does not change the CASA burden | Documented |
| Idempotency of adding a present label / removing an absent one | Succeeds as a no-op | Observed only, not documented |
| Duplicate label name on `labels.create` | 409 observed in the wild; docs document only 400 for reserved names | Observed only |

**Key implication**: the two mirror-update strategies the strong defaults suggested are both worse than the fold here. "Run one incremental sync after the mutation" usually returns nothing, because history propagation lags by minutes; the mirror would misreport handled mail (still `UNREAD`) to every agent query in that window. "Return accepted-pending-sync always" is honest but leaves the same window. Folding Gmail's own response `labelIds` closes the common window with zero extra quota and zero locally computed state, and it is what ADR-0082 already prescribes and what `recategorizeExpense` already does. The fold is not an optimistic patch: the mirror stores only bytes Gmail returned. One race stays open and is accepted (see the Failure model's last row): a concurrent sync pass can land a pre-modify snapshot after the fold, regressing the row until the modify's own history record replays. Every byte involved is still Gmail-produced state; the hazard class is staleness that self-heals, never fabrication.

## Design decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| One primitive, six actions | 2 coherence | One `modifyMessageLabels` core; the six actions are vocabulary in adapters and docs | Gmail's API grain is one call; six intent-named cores would be six wrappers around identical code. Asymmetric win: 6 product actions, 1 code path. |
| Mirror update after success | 1 evidence | Fold the response's `labelIds` via a single-row patch; when the response lacks `labelIds`, report `folded: false` ("accepted by Gmail; mirror catches up on the next sync") | ADR-0082 prescribes the fold; measured history latency (2.5-8 min) refutes sync-after-mutate; the response is authoritative Gmail state, so no second source of truth is created. The `labelIds`-absent branch exists because the field is not contractually guaranteed. |
| No optimistic local computation | 2 coherence | The mirror is never patched with a locally computed union/difference of label sets | The fold writes Gmail's bytes or nothing. This is the enforceable line between "fold" and "optimistic patch", and a test pins it (see Test plan). |
| Scope | 3 taste | `connect` requests `gmail.modify` unconditionally; no dual read-only/write consent modes | Write-through is the product (the UI gates on it, shell spec Phase C/D); a consent fork would be a mode with no user. Same Restricted class as readonly, so no verification-burden change. Existing readonly tokens keep reading; the first write 403s with a "re-run local-mail connect" message. Revisit when: a real read-only-mirror user appears. |
| Send stays refused | 2 coherence | App-level refusal, stated in README and tool descriptions | No scope grants modify-without-send (verified), so the boundary can only live in the app. Deferred-not-refused per ADR-0098 (drafts are expressible); it waits for its own trust design. |
| Multi-id input | 3 taste | Actions take `ids: string[]` (1 to 100), executed as a serial per-id `messages.modify` loop | Multi-id is Gmail's own grain (`batchModify` exists); per-id execution keeps the fold and per-id errors. 100 ids = 500 units, well inside 6,000/min. Serial, not concurrent: mutation ordering stays obvious and throttling stays away. Revisit when: real usage wants >100. |
| Partial failure | 3 taste | Per-id errors (404, 400) are collected and the loop continues; systemic errors (token, throttle, network) abort the remainder | A dead token fails every remaining id identically; continuing would burn retries to report one fact. A 404 on one id says nothing about the next. |
| Label input | 3 taste | The core takes Gmail label ids only. Adapters (CLI, MCP) resolve names to ids through one shared helper: exact-name lookup in the mirrored `labels` table, one fresh `labels.list` on miss, error if still missing | The user default. Ids stay the only identity; names are an adapter courtesy. No local label identity is ever invented. |
| Return shape | 2 coherence | An operation summary per id: `{ id, labelIds (Gmail's post-state or null), folded }` plus per-id errors; never the raw Gmail response, never a mirror row | Mirrors `RecategorizeResult`. The raw response is an unstable wire shape; a mirror row would imply the mirror is the authority the caller should read. |
| Local precondition checks | 2 coherence | Only two: non-empty add/remove sets, and name resolution. No system-label blocklist | "Gmail accepts or rejects the mutation" is the model; a local `DRAFT`/`SENT` blocklist would drift and duplicate Gmail's authority. |
| MCP surface | 2 coherence | One `modify_labels` mutation tool; no per-intent tools | Same collapse as the core. The tool description documents the `UNREAD`/`INBOX` vocabulary. Per-intent sugar tools can come later if models fumble it. |
| Trust boundary | 1 evidence | Copy local-books exactly: three-tier `'read' | 'write' | 'mutation'`, `LOCAL_MAIL_READ_ONLY` unlists mutation tools AND is enforced in the core (required argument), host approval prompt is the interactive boundary | ADR-0073 invariant 1; local-books `mcp.ts:239` (catalog filter) and `recategorize.ts` (core gate). A server-side auth gate adds nothing: anything that can spawn `local-mail mcp` runs as the user and can already read the 0600 credentials file. |
| Annotations | 1 evidence | `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true` on `modify_labels` | MCP spec: "destructive" means irreversible; every Phase 3 op is a reversible, idempotent label flip (add-present/remove-absent are observed no-ops). Deliberate divergence from local-books' per-tier `destructiveHint` mapping: its one mutation moves money. Annotate per-tool truth. Trash/send, when they arrive, get `destructiveHint: true`. |
| CLI verb | 3 taste | One `modify` verb: `local-mail modify <id...> [--read|--unread|--archive|--unarchive] [--add <label>...] [--remove <label>...]`; intent flags desugar to add/remove sets | One verb = one surface to test and document. Six top-level verbs are ergonomic sugar an implementer may add later without design impact. |

## Architecture

```txt
CLI `modify` ----\
MCP `modify_labels` --> resolveLabelIds (names->ids; the core takes ids only)
                          |
                          v
                 modifyMessageLabels(core)          src/modify.ts (new)
                   readOnly? -> refuse, zero network
                   for each id (serial):
                     client.modifyMessage(id, {add, remove})   POST, new
                       401 -> one token refresh (existing client behavior)
                       429/5xx/retryable 403 -> existing backoff
                       404/400 -> per-id error, continue
                       403 insufficientPermissions -> abort all (Gmail's raw error)
                     response.labelIds present?
                       yes -> db.patchMessageLabels(id, labelIds)  fold, best-effort
                       no  -> folded: false ("mirror catches up on next sync")
                   -> ModifyOutcome (per-id summaries)
                          |
                          v
                 history.list (existing watch loop / sync verb)
                   replays the same change as labelsAdded/labelsRemoved
                   -> idempotent reconfirmation; the fold and the sync
                      converge on identical bytes (both are Gmail state)
```

New surface, smallest honest set:

```ts
// gmail-client.ts: request() grows method/body; one new client method
modifyMessage(id: string, body: { addLabelIds: string[]; removeLabelIds: string[] })
  : Promise<Result<GmailMessage, GmailClientError>>   // validated: id/threadId required, labelIds optional (matches the slim response)

// db.ts: the fold, same semantics as applyHistoryBatch's labelPatch branch
patchMessageLabels(messageId: string, labelIds: string[], syncedAt: string): boolean
  // patches raw.labelIds in place; returns false when the row is absent
  // (unmirrored message, e.g. SPAM/TRASH): skip, next sync converges.
  // Touches exactly one messages row and NOTHING in _meta: bumping
  // last_synced_at from a fold would silently defeat decideMode's staleness
  // guard. Benign sweep interaction, do not "fix": a fold's newer synced_at
  // can retain a mid-pull-trashed row past finishFullPull's sweep, with
  // honest TRASH labels; the existing incremental labelPatch already
  // produces the same retention, and the next full pull converges.

// modify.ts (new): the core, ported from recategorizeExpense's shape
modifyMessageLabels({ deps, input, readOnly }): Promise<Result<ModifyOutcome, ...>>
  // readOnly is REQUIRED with no default: every adapter must decide explicitly

type ModifyOutcome = {
  results: {
    id: string;
    labelIds: string[] | null;  // Gmail's post-mutation state, when returned
    folded: boolean;            // false = accepted by Gmail, mirror pending sync
    error: { name: string; message: string } | null;
  }[];
  // A systemic abort (token, throttle, network) returns PARTIAL results:
  // per-id entries for every attempted id (successes keep their folds) plus
  // the systemic error; unattempted ids are simply absent. Whole-batch retry
  // is safe because every op is an observed no-op when already applied.
  aborted: { name: string; message: string } | null;
};
```

## Trust boundary (MCP and CLI)

The interactive trust boundary is the MCP host's approval prompt, per ADR-0073 invariant 1: the `tier` field is a trusted Epicenter field and the host pauses mutations for approval; `readOnlyHint`/`destructiveHint` are honest advertising a conservative host reads. Local Mail adds no server-side auth gate because there is nothing for it to defend: any process that can spawn `local-mail mcp` runs as the user and can already read `credentials.json` and call Gmail directly. What the server does add is a blast-radius lever the user holds against over-eager agents:

- `tier` grows to `'read' | 'write' | 'mutation'`: `query`/`status` stay `read`, `sync` stays `write` (it writes only the local mirror), `modify_labels` is `mutation` (it writes Gmail).
- `LOCAL_MAIL_READ_ONLY` (env, default false, mirroring `LOCAL_BOOKS_READ_ONLY`): when set, mutation-tier tools are unlisted from the MCP catalog, and the core independently refuses (the required `readOnly` argument), so removing the catalog filter cannot silently enable writes. `sync` and `query` stay available; read-only means "cannot touch Gmail state", not "cannot refresh the mirror". The CLI `modify` verb honors the same flag through the same core argument.
- Write tools are listed by default with honest annotations. Default-hiding them behind an opt-in flag would make the primary Phase 3 feature dead on arrival in every host config; the user configured this server against their own account deliberately.

## Failure model

| Failure | Where it surfaces | Behavior |
| --- | --- | --- |
| Token expired/revoked | `TokenError` from the token manager | Abort all ids; message names `local-mail connect` |
| Token lacks `gmail.modify` (pre-Phase-3 grant) | Gmail 403 `insufficientPermissions` (a non-retryable 403 in the existing client) | Abort all ids with Gmail's raw error. **Refusal (2026-07-02):** the bespoke `ReadOnlyGrant` reconnect message was a transitional bridge for readonly-era tokens; removed once the sole such grant re-consented. `prompt=consent` + always-`gmail.modify` means no fresh connect can reproduce a readonly token, so the branch had no live producer. Revisit if a read-only-mirror consent mode ever ships. |
| Unknown message id | Gmail 404 | Per-id error; loop continues |
| Invalid/unknown label id, unapplicable system label | Gmail 400 (body carries Gmail's own message, e.g. `Invalid label: X`) | Per-id error with Gmail's message; loop continues |
| Rate limit | 429 / retryable 403; existing backoff, then `Throttled` | Abort remaining ids (systemic) |
| Network | existing retry, then `Network` | Abort remaining ids (systemic) |
| Label name does not resolve | Adapter, before any Gmail call | Error names the label and says to create it in Gmail (or pass an id); no network mutation attempted |
| Fold cannot write (mirror locked past busy_timeout, disk error) | `patchMessageLabels` best-effort catch | The mutation still succeeded; report `folded: false`, next sync reconciles. Never report a successful Gmail write as a failure (the recategorize lesson: that invites a retry). |
| Mutation succeeded, process dies before fold | Nothing persisted locally | Mirror is stale until the next history pass; by design, no pending-operation state exists to recover |
| Concurrent sync pass lands a pre-modify snapshot after the fold | Nothing surfaces; the row regresses silently | Accepted race: an in-flight incremental pass (or a full-pull page fetched pre-modify) can commit an older Gmail snapshot after the fold, regressing the row until the modify's own history record replays (minutes, per the measured latency). Never fabricated state, never a retry trigger; do not add versioning or a pending-op record to "fix" it. |

## Test plan (what proves SQLite never becomes write authority)

Extend the existing fakes (`createFakeGmailClient` seeding and call counters, `sync-mailbox.test.ts:43-72`).

```txt
The authority pins
  1. Gmail rejects (400/404) -> mirror byte-identical to before; no row touched
  2. Fold writes Gmail's bytes, not local math: fake modify response returns
     labelIds that DIFFER from what add/remove arithmetic would predict
     (Gmail dropped a label concurrently) -> mirror equals Gmail's response
     exactly (the fold-vs-optimistic-patch line, pinned)
  3. Response without labelIds -> mirror untouched, outcome folded: false
  4. Convergence: after a fold, replaying the same change as a labelsAdded
     history record is a no-op (idempotent, same bytes)
  5. Regression race heals: fold, then applyHistoryBatch carrying an OLDER
     pre-modify snapshot (the accepted race), then the modify's own history
     record -> row converges back to Gmail's post-modify state
  6. No new mirror state: SCHEMA_VERSION unchanged; no pending-ops/outbox/
     dirty-flag table exists (assert sqlite_master); a failed mutation
     leaves zero trace in SQLite; a fold leaves _meta byte-identical
     (cursor, last_synced_at, last_full_pull_at untouched)

The gate pins
  7. readOnly: true -> refused; zero Gmail client calls (counter = 0)
  8. MCP with LOCAL_MAIL_READ_ONLY=1 -> modify_labels absent from tools/list;
     query/status/sync still listed (port of local-books mcp-server.test.ts:228)
  9. modify_labels annotations: readOnlyHint false, destructiveHint false,
     idempotentHint true

The loop pins
  10. One 404 mid-list -> that id errors, later ids still processed and folded
  11. Throttled/token error mid-list -> remaining ids NOT attempted; partial
      results for attempted ids survive in the outcome (systemic abort)
  12. Fold hitting SQLITE_BUSY -> outcome ok with folded: false, no throw
  13. Unmirrored message id (row absent) -> Gmail called, fold skipped,
      folded: false

The adapter pins
  14. Label name resolves via mirror; unknown name -> one fresh listLabels,
      then a local error naming the label, zero modify calls
  15. Empty add AND remove sets -> local precondition error, zero network
  16. MCP e2e over stdio: modify_labels round-trip against the fake,
      including the isError channel for a Gmail rejection
```

Live (owner, GUI terminal): mark a message read on the desktop, watch it show read in Gmail's phone app; archive, watch it leave the phone inbox; both without waiting for a sync pass locally (the fold), then confirm the next `--watch` pass reports the replayed history records without churn.

## Implementation waves

Build, prove, remove has nothing to remove here; the waves are build-and-prove, each independently landable.

- [x] **3.0 Scope flip.** `oauth.ts`: `gmail.readonly` becomes `gmail.modify` in `connect`'s scope request; README documents the re-consent (one command) and the send-stays-refused posture. (A 403 `insufficientPermissions` from a stale readonly token surfaces Gmail's raw error; the transitional reconnect-message mapping was removed 2026-07-02 once the sole readonly grant re-consented.)
- [x] **3.1 Client POST.** `request()` grows `method`/`body`; `modifyMessage(id, {addLabelIds, removeLabelIds})` validated against `GmailMessageSchema` (its optional `labelIds` already matches the slim response). Existing retry/refresh/throttle behavior applies unchanged.
- [x] **3.2 The core and the fold.** `db.patchMessageLabels` (extract the labelPatch semantics already inside `applyHistoryBatch` into a single-row method both call), `src/modify.ts` with `modifyMessageLabels` (required `readOnly`, serial loop, per-id/systemic error split, best-effort fold). Tests 1-6, 10-13.
- [x] **3.3 CLI.** `modify` verb with intent flags desugaring to add/remove sets; `resolveLabelIds` helper (mirror lookup, fresh `labels.list` on miss); `LOCAL_MAIL_READ_ONLY` in config. Tests 7, 14, 15.
- [x] **3.4 MCP.** Three-tier `tier`, catalog filter under `LOCAL_MAIL_READ_ONLY`, `modify_labels` tool (TypeBox input: `ids` 1-100, optional `addLabelIds`/`removeLabelIds` accepting ids or names via the same helper), per-tool annotations. Tests 8, 9, 16.
- [x] **3.5 Live round-trip (owner).** The phone-visible verification above; this is the gate the shell spec's Phase C/D UI waits on.
  > **Live note, 2026-07-02:** Owner verified `modify 19f25c61b98fe50e --read` and `--unread` against Gmail web/phone. Gmail's `messages.modify` response carried `labelIds`; both CLI outcomes returned `folded: true`, and the mirror query matched the returned labels immediately. Owner then verified `--archive` and `--unarchive`: archive removed `INBOX`, unarchive restored `INBOX`, and both returned `folded: true`. After establishing the first full-sync cursor (`559146`), a post-cursor incremental sync replayed the archive history cleanly: `cursorBefore: "559146"`, `cursorAfter: "559160"`, `labelsPatched: 1`, `failure: null`. The message was restored with `--unarchive`, and the restore-side incremental sync converged cleanly once Gmail history caught up.

## Stop point: what must be true before UI work starts

UI (shell spec Phases C and D) starts only when all of:

1. The mark-read and archive cores are live-verified round-trip: desktop mutation, phone Gmail reflects it, next sync pass replays it without churn. As of 2026-07-02, mark-read/unread and archive/unarchive are phone-visible and folded; archive and restore history replay after a stored cursor are verified.
2. The stale-grant path is settled: a readonly-era token surfaces Gmail's raw 403, and `connect` requests the write-capable `gmail.modify` grant.
3. The failure surfacing is settled as data (this spec's `ModifyOutcome` and error names), so UI work binds to a stable shape instead of inventing one.

Nothing in this spec adds HTTP endpoints; the shell spec's `POST /api/messages/:id/...` adapters are Phase D work that wraps `modifyMessageLabels` the same way the CLI does.

## Open questions

1. **Does the live `messages.modify` response reliably carry `labelIds`?** Not contractually documented; universally observed. **Resolved 2026-07-02 for the live Phase 3.5 sample:** mark-read, mark-unread, archive, and unarchive all returned `labelIds` and folded immediately. Keep the `folded: false` branch because the field is still not contractual; if it ever comes back absent, the escape hatch is a `messages.get` refetch (20 units) behind the same fold, still Gmail-sourced.
2. **Persist the granted scope at connect time?** The token grant response includes `scope`; storing it would let the CLI warn before a write instead of after a 403. **Recommendation**: skip for v1; the raw 403 is one round-trip and zero new state. (Resolved 2026-07-02: even the bespoke reconnect-message mapping was removed as an unearned bridge; the raw Gmail 403 is the whole surface now.) Revisit if the error proves confusing live.
3. **Per-intent MCP sugar tools (`mark_read`, `archive`)?** **Recommendation**: wait for evidence that models fumble the label vocabulary in `modify_labels`; the description documents `UNREAD`/`INBOX` explicitly.
4. **ADR at flip time.** The durable decisions here that outlive this spec: the six-actions-one-primitive collapse, the single-scope posture (`gmail.modify`, send refused at app level, no dual consent modes, no readonly-era reconnect bridge; a stale-scope write surfaces Gmail's raw 403), and the fold-is-not-optimistic-patch line. **Recommendation**: record as one short ADR when Phase 3 lands and this spec is deleted; check the ADR number against main first (a concurrent branch has minted another 0098).

## Success criteria

- [x] `bun test` and `bun run typecheck` green in `apps/local-mail`; all sixteen test-plan pins present.
- [x] Live: mark-read on the desktop is visible in Gmail's phone app without a local sync pass in between (the fold), and the next `--watch` pass replays it cleanly. Mark-read/unread and archive/unarchive folds are verified; archive and restore history replay after cursor `559146` are verified.
- [x] `LOCAL_MAIL_READ_ONLY=1 local-mail mcp` lists no `modify_labels`; the CLI `modify` verb refuses under the same env.
- [x] Grep-level: no new mirror tables, no pending-operation state, `SCHEMA_VERSION` unchanged.

## References

- `apps/local-books/src/books/recategorize.ts`: the write-through core shape being ported (required `readOnly`, upstream-first, best-effort fold, honest `folded`).
- `apps/local-books/src/commands/mcp.ts:239`: the read-only catalog filter; `test/mcp-server.test.ts:155-167,228`: the annotation and unlisting tests to port.
- `apps/local-mail/src/{gmail-client,sync,db,runtime,mcp,cli,oauth,schema}.ts`: the Phase 2 engine being extended.
- `docs/adr/0073-*.md` (tiers and host approval), `docs/adr/0082-*.md` (write-through), `docs/adr/0098-local-mail-state-round-trips-through-gmail.md` (the round-trip rule).
- Gmail API references (fetched 2026-07-02): `users.messages/modify`, `users.messages/batchModify`, `users.threads/modify`, `users.labels`, `users.history/list`, `guides/labels`, `guides/sync`, `reference/quota`, `auth/scopes` under `developers.google.com/workspace/gmail/api/`.
