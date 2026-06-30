# Matter editable views

State: Draft

## Thesis

Matter's invariant is "disk is truth," not "views are read-only." The grid already
writes markdown through a pure, per-file-serialized primitive
(`editField` -> `write` -> `write_entry` -> watcher rebuild). The grid is just the
first caller. So a view reads the same in-memory classified rows the grid renders and
writes edits back through the *same* `saveField`/`saveBody`.

This spec adds **native, built-in editable views** (board, calendar, form) declared in
`matter.json`. The grid stays the default; the new views reuse `saveField` and the
existing field editors for in-place edits, and add two small new surfaces (a read-only
value renderer and a draft-collecting create form) that the current widgets do not
provide.

Out of scope (deferred): a generic `ViewSurface` abstraction extracted from the grid,
and agent-authored HTML views in a sandboxed iframe. See "Deferred."

## Ground truth (verified against code; do not re-derive)

- Contract (`packages/matter-core/src/core/contract.ts:68`): `Contract = { fields: ContractField[]; untyped; unmatchedOptional; searchable }`. `parseContract` (`:190`) only classifies; field resolution is in `validateContract` (`:93`). A `{}` / no-`fields` marker returns `{ kind: 'untyped' }` with NO `Contract` object (`:203`). Tests assert `{"views":{}}` is untyped (`contract.test.ts:192`) — preserve that.
- Field kinds (`packages/field/src/field.ts:172`): `string reference integer number boolean date instant datetime url select multiSelect tags json`. Each `Field` carries `.check(value) => boolean`; the contract precompiles it (`contract.ts:133`). `.check` on a single scalar is real (`field.test.ts:325`).
- Write primitives (`apps/matter/src/lib/table.svelte.ts`): private `write(fileName, edit)` (`:155`), `saveField(fileName, key, value)` (`:188`), `saveBody(fileName, body)` (`:197`), per-file lock `serializeWrite(fileName, run)` (`:128`). `write` applies its own bytes to memory synchronously on success (`:177`). Pure transforms `editField` (`serialize.ts:46`) / `editBody` (`:60`); `serializeEntry` (`:28`). **The grid receives only the narrowed `TableView = Pick<TableHandle, 'folderName'|'read'|'saveField'|'saveBody'>` (`:252`) — it has NO folder path and NO create primitive.**
- Read: `query_mirror(root, sql, limit?) -> { columns, rows }` (`src-tauri/src/mirror.rs:159`). `buildStemQuery` emits `SELECT "stem"` only (`query.ts:62`); `runQuery` maps `rows[0]` to stems (`mirror.svelte.ts:101`). `createTableQuery` (`table-query.svelte.ts:34`) owns interactive `where`/`match`/`toggleSort` -> `orderedStems`, debounced 200ms (`:28`); it has no way to seed a declared default query and its `Sort` is `{column,dir}`, not a raw `orderBy` string.
- Rows reach the grid as in-memory CLASSIFIED rows: `TableGrid` renders `view.conformance` cells, looked up by stem in the order `orderedStems` gives (`TableGrid.svelte:97`). Frontmatter values live ONLY in these in-memory rows, never in the mirror result.
- Field rendering: `FIELD_COMPONENTS[kind]` (`registry.ts:45`); `FieldProps = { cell: RenderableCell, save }` (`field-props.ts:56`) renders AND edits one existing cell, writing through per field. `ModeledCell.mode` is `'grid'|'detail'` (presentation density), NOT edit-vs-create-vs-readonly (`ModeledCell.svelte:20`). There is no read-only renderer and no create/draft mode.
- View routing: `?table=X` picks the table (`VaultShell.svelte:34`), `?view` picks a vault-wide panel `'sql'|'db'` (`routes.ts:17`, resolved `VaultShell.svelte:43`). Absent -> grid.
- Tauri commands in `lib.rs:14`. `write_entry(path, file_name, content)` (`entry.rs:37`) and `read_entry` (`:24`) join `file_name` with NO traversal guard; `read_entry` returns `None` for a missing file.

## Design

### A view = classified rows in, `saveField` out

```
order/filter: mirror -> orderedStems (existing createTableQuery)
rows:         in-memory classified rows (view.conformance), looked up by stem
render:       per view.type, reusing field EDITORS for in-place edit of existing rows,
              plus a new read-only renderer for card display
save:         gesture -> saveField(`${stem}.md`, column, value)  // identical to grid
settle:       optimistic from in-memory write (NOT the mirror; mirror is debounced)
```

Crucial correction from review: board/calendar group and settle off the **in-memory
rows**, because the mirror only returns stems and its re-query is debounced ~200ms. A
view that re-grouped from the mirror would visibly snap a dragged card back. The mirror
is used only to order/filter the stem list.

### `matter.json` gains a `views` array (typed tables only)

Additive, optional. Parsed in `validateContract` so it can see field kinds. A `views`
key on an untyped (`{}`) table is ignored and the table stays untyped (preserves
`contract.test.ts:192`). A malformed entry is dropped with a contract error; the grid
and valid views still work.

```jsonc
{
  "fields": { "status": { "enum": ["idea","drafting","edited","scheduled","posted"] },
              "publish_at": { "type": "string", "format": "date-time" },
              "platform": { "type": "string" } },
  "views": [
    { "id": "pipeline", "type": "board", "groupBy": "status",
      "columns": ["idea","drafting","edited","scheduled","posted"],
      "card": ["title","platform"], "query": { "orderBy": "publish_at asc" } },
    { "id": "schedule", "type": "calendar", "dateField": "publish_at", "card": ["title","status"] },
    { "id": "capture",  "type": "form", "fields": ["title","platform","status"], "body": true }
  ]
}
```

### matter-core additions (all pure, all bun-tested)

```ts
// packages/matter-core/src/core/view.ts (new)
export type ViewQuery = { where?: string; match?: string; orderBy?: string };
export type ViewSpec =
  | { id; type:"board";    groupBy:string; columns?:string[]; card?:string[]; query?:ViewQuery }
  | { id; type:"calendar"; dateField:string; card?:string[]; query?:ViewQuery }
  | { id; type:"form";     fields:string[]; body?:boolean };

export function parseViews(raw: unknown, fields: ContractField[]):
  { views: ViewSpec[]; errors: ViewError[] };
//   id slug-safe + unique; board.groupBy kind ∈ {select,string,reference};
//   calendar.dateField kind ∈ {date,datetime,instant}; form.fields + card name real fields.

// The decision logic, extracted so it is testable without a UI:
export function groupRowsByField(rows, groupBy, columns):           // board buckets + Other/Unassigned
  { bucket: string; rows: Row[] }[];
export function bucketRowsByDate(rows, dateField):                  // calendar day -> rows
  Map<string, Row[]>;
export function dropTargetValue(view, target): unknown;            // bucket/day -> field value to write
export function slugifyStem(title: string): string;                // ^[a-z0-9][a-z0-9-]*$, no .. or sep
export function buildNewEntry(fields, values, body):               // create: required + .check, then serializeEntry
  { ok: true; text: string } | { ok: false; errors: ViewError[] };
```

Add `views: ViewSpec[]` to `Contract`. The grid never reads `views`.

### Field surfaces

- In-place edit of an EXISTING row's cell (board card expanded, calendar event open):
  reuse the current editors via `FIELD_COMPONENTS` + `saveField`. No change.
- Read-only card display (`card` fields on board/calendar): NEW `<FieldValue cell>`
  component (one small renderer that formats a value per kind, no controls). The current
  widgets are editors; they cannot be reused read-only.
- Capture form CREATE: NEW `<CreateForm>` that buffers a draft of typed values across
  fields BEFORE any file exists, validates with `buildNewEntry`, then writes once. This
  is net-new; the per-field write-through widgets do not support drafting.

### createRow needs a wider table handle

`createRow` must `write_entry` into the table's folder, but `TableView` (`:252`) hides
the path and the create primitive. Widen the handle passed to views to expose
`createEntry(fileName, text)` (a thin public wrapper over the private `write`/`write_entry`
that goes through `serializeWrite`). Filename = `slugifyStem(title)` + timestamp suffix +
`.md`; reject collisions; the created file is classified against the contract immediately,
so `buildNewEntry` must satisfy every `required` field up front.

### Per-table view routing

Resolve `?table=X&view=Y` against the ACTIVE table's `contract.views` (not a single
global list). Keep `?view=sql|db` as vault-wide panels. Unknown/absent view -> grid. The
switcher row is rebuilt per active table from its `contract.views` (by `title ?? id`).

## Path safety (Wave 0, prerequisite for create)

`write_entry`/`read_entry` join `file_name` with no guard (`entry.rs:24,:37`), and the
tmp path is `.{file_name}.tmp` (`:40`). Forms generate filenames from user text, so:
- JS: `slugifyStem` rejects `/ \ ..` and leading `.`; always `.md`.
- Rust: reject `file_name` containing a separator or `..` BEFORE computing tmp.

## Waves (reordered per review; Wave 2 grid refactor cut)

- Wave 0: harden `write_entry`/`read_entry`. Rust unit test. Mergeable now.
- Wave 1: `view.ts` (`ViewSpec`, `parseViews`, the pure logic fns) + `Contract.views`,
  parsed in `validateContract`, untyped tables unaffected. Bun unit tests. No UI.
- Wave 2: `<FieldValue>` read-only renderer + per-table `?table&view` routing + switcher.
  Grid stays default and UNCHANGED.
- Wave 3: board view on in-memory rows, optimistic, `saveField` on drag. Proof point.
- Wave 4: calendar view.
- Wave 5: form view: widen the table handle with `createEntry`, `<CreateForm>`, create flow.

Each wave ships alone. Wave 3 is the first user-visible editable view, built on the
existing handle, no grid refactor.

## Testing

Stack today: `bun test` (`bun:test`); all existing tests are pure-function
(`matter-core/src/core/*.test.ts`, `apps/matter/.../markdown-*.test.ts`). There is NO
Svelte component test runtime, and NO Playwright / tauri-driver / WebdriverIO harness
anywhere. Rust uses `cargo test` (`#[cfg(test)]` in `entry.rs`, `mirror.rs`).

Consequence: **a real end-to-end test (drag a card -> assert the `.md` on disk changed ->
assert the mirror reprojects) cannot run today.** It needs a Tauri WebDriver harness
(`tauri-driver` + WebdriverIO) + CI plumbing that does not exist. Decide explicitly:
fund that harness, or treat the disk -> watcher -> mirror loop as manual QA.

The architecture lets us avoid most of that by pushing decision logic into pure
functions:

- Wave 0: Rust unit test rejects `..`/separator filenames.
- Wave 1: bun unit on `parseViews` (valid/invalid/degrade, untyped-table ignore) and on
  `groupRowsByField` / `bucketRowsByDate` / `dropTargetValue` / `slugifyStem` /
  `buildNewEntry`. This is where the real logic lives, and it is fully testable.
- Projector round-trip without a UI: `core/sqlite.test.ts` already drives the projector
  purely. Add a case: a row whose `status` changed projects to the expected column/value.
  This proves "edit -> reproject" at the projector boundary (the watcher loop stays QA).
- Waves 2-5 reactive `.svelte.ts`/components: NOT unit-testable with the current harness.
  Keep them thin; put logic in the Wave 1 pure fns; cover the UI with manual Tauri smoke
  until/unless an e2e harness is funded.

Honest acceptance: the bullets below are MANUAL QA today, not automatable.
- Vault with the example `matter.json` shows tabs Grid / Pipeline / Schedule / Capture.
- Drag a card on Pipeline -> `status:` in that file changes on disk -> reopen preserves it.
- Invalid value (bucket not allowed by the `status` enum) is rejected, no write.
- Malformed `views` entry drops that view + surfaces a contract error; grid still works.
- `write_entry` rejects a `file_name` with `..` or a separator (this one IS a Rust unit test).

## Deferred

- `ViewSurface` extraction (grid + views behind one interface): only after board AND
  calendar exist and the shared shape is observed. Refactoring the 639-line grid first,
  with no component regression harness, is high risk for zero user value.
- Agent-authored sandboxed HTML views: later spec. Reuses the create/edit primitives but
  adds typed postMessage broker (no raw writes, no path into the iframe), capability grant
  in `matter.json` (never in the HTML), `sha256(html)` pinning (injected rewrite -> read-only),
  and a write journal for undo. Do not build until native editable views prove demand.
