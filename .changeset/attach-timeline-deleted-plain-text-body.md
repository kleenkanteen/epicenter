---
'@epicenter/workspace': minor
'@epicenter/filesystem': minor
---

Breaking (pre-1.0): delete `attachTimeline` and make a child-doc text body a plain `Y.Text` (ADR-0107, the clean-break resolution of ADR-0106 step-3).

- `@epicenter/workspace`: `attachTimeline` and its module are removed from the public API. `attachPlainText` gains an `appendText(text)` method beside `read`/`write` (append to the end of the `Y.Text` in one transaction).
- `@epicenter/filesystem`: `filesTable` now binds `content: attachPlainText`, so a file body is stored at `getText('content')` instead of `getArray('timeline')`.

Durable-format break with no migration reader, taken under a greenfield zero-users assumption: a body written by the old timeline layout reads back empty under the new layout. If you have existing timeline-backed bodies to preserve, do not take this upgrade without writing a migration first. Editors bind `handle.binding` (the `Y.Text`) directly.
