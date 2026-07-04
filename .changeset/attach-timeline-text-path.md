---
'@epicenter/workspace': minor
'@epicenter/filesystem': patch
---

Breaking (pre-1.0): trim `attachTimeline` to its single text layout (ADR-0106). The polymorphic text/rich-text/sheet body is refused until a product earns it, so the handle drops `asRichText`, `asSheet`, `currentType`, and `restoreFromSnapshot`, along with the `RichTextEntry`/`SheetEntry`/`TimelineEntry` union and `ContentType` (the entry type collapses to `TextEntry`). `read`/`write`/`appendText`/`asText`/`batch`/`observe` keep their behavior exactly, including `asText()` seeding an empty text entry on an empty doc. The dead sheet and rich-text machinery (`sheet.ts`, `richtext.ts`, `fractional-index.ts`, their CSV serializers, and the `./document/attach-timeline` subpath export) is deleted; `attachTimeline` still ships from the package root. `@epicenter/filesystem` inlines the one ordering helper it used (`computeMidpoint`) into `formats/sheet.ts` and drops its dead re-export of the workspace ordering helpers.

No data migration: the durable `timeline` slot name and its stored entry `Y.Map` shape (`type`/`content`/`createdAt`) are frozen and untouched, and every stored entry is already a `text` entry, so existing bodies read back unchanged. Collapsing the timeline `Y.Array` to a plain single-layout body is a separate, later, separately-approved migration (ADR-0106 step 3).
