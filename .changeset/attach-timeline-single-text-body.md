---
'@epicenter/workspace': minor
---

Breaking (pre-1.0): collapse `attachTimeline` to a single-text-body API. Following the ADR-0106 text-path trim, the handle now exposes only `read` / `write` / `appendText` / `asText` / `observe`. The `currentEntry` getter, the exported `TextEntry` type, the `length` getter, and the `batch` method are removed: none had a production consumer, and `currentEntry`/`length` only leaked the internal entry-array that a later single-layout migration (ADR-0106 step 3) will delete. To count stored entries, read `ydoc.getArray('timeline').length` directly; to batch writes, call `ydoc.transact(fn)` (`write`/`appendText` already transact internally).

No data migration: the durable `timeline` slot and stored entry `Y.Map` shape (`type`/`content`/`createdAt`) are frozen and untouched. `pushText` still writes byte-identical entries; `type` and `createdAt` are written for the durable format even though the handle no longer reads them back.
