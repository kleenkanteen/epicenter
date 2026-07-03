# Vocab TERMS Layer: a chat that remembers your vocabulary

**Date**: 2026-06-27 (terms rewrite 2026-07-02)
**Status**: Draft
**Owner**: Vocab (apps/vocab)
**Branch**: managed (Phase 1 words layer committed as `de5a8fe3a2`; this spec replaces it)

## One Sentence

Select any text in a Vocab chat and save it as a term, with a note you write yourself and a stage (new, understood, usable) that records whether you can understand it or produce it.

## How to read this spec

```txt
Read first:
  One Sentence
  Motivation (what shipped, why it changes)
  Terminology decisions
  The terms schema (catalog)
  Implementation Plan (Wave 2)
  Success Criteria

Read if changing the design:
  The note ownership landmine
  What this refuses (and must keep refusing)
  Future phases (the loop, re-expressed)
```

## Motivation

### What shipped (Phase 1 "words", commit `de5a8fe3a2`)

```ts
wordsTable = { id: WordId, term, gloss, status: new|learning|known, createdAt }
```

Capture is tap-a-token: the romanizer stamps `term` on CJK segments, `ruby.svelte` wraps them in buttons, and `ConversationView` passes `onTermTap` into the shared `Markdown` component. A `glossFor(term)` seam (`apps/vocab/src/lib/gloss.ts`) prefills meanings. `WordsPanel` shows term, editable gloss, a status cycle button, and a `known: N` count.

### Why it changes

A 2026-07-02 terminology audit re-grilled the model from first principles. Two findings force the rewrite:

1. **Capture moves from tap-a-token to select-arbitrary-text.** Tap capture is bounded by segmenter output, so multi-character words, phrases, and 成语 are uncapturable (the spec's old "tapping inside 学习者" edge case was a symptom, not an edge). Selection makes any span a first-class capture, which also deletes the entire tap plumbing in `packages/ui/src/markdown` and the `termsOnlyRomanizer` workaround.
2. **Once phrases are first-class, `word` is the wrong noun.** The first saved phrase falsifies it. The object is a `term`: a unit of language of any length you intend to acquire.

Dropping the dictionary follows: with arbitrary selections, CC-CEDICT lookup can no longer prefill reliably, and the chat itself answers "what does this mean". The meaning lives where you saved it.

## Terminology decisions

Settled by the 2026-07-02 audit. Do not reopen without new evidence.

| Name | Decision | Reason |
| --- | --- | --- |
| `term` (object, table `terms`) | Keep | Selection capture makes phrases first-class; `word` breaks on the first one. Aligns with the neutral `Segment`/`term` vocabulary already in `packages/ui/src/markdown`. |
| `text` (field) | Keep | `term.term` stutters; `surface` is linguist jargon a first reader trips on; `text` honestly names "the verbatim selection, trimmed, never normalized". |
| `note` (field) | Keep | Human-owned free text is a note. Singular, and deliberately not the old AI-owned `notes` (see landmine below). |
| `stage` (field) | Keep | Ordered acquisition milestones. `status` collides with the dictation recorder's `status` in this same app; `state` is unusable in a runes codebase; `level` invites numeric SRS creep; `capability` is repo-loaded (ADR-0079). |
| `new` / `understood` / `usable` | Keep all three | Receptive vs productive vocabulary is a real distinction with distinct tutor behaviors: explain `new`, create production openings for `understood`, retire `usable` from focus. Better than the old mushy `learning` middle. |
| `createdAt` | Keep | The one field outside the product sentence; earns its keep as the panel's newest-first sort key (nanoid ids are not time-ordered). |

## The terms schema (catalog)

```ts
/** Branded term id: a nanoid minted when a term is saved. */
export type TermId = Id & Brand<'TermId'>;
export const generateTermId = (): TermId => generateId<TermId>();

export const termsTable = defineTable({
	id: field.string<TermId>(), // branded, minted on save
	text: field.string(), // the verbatim selection, trimmed, never normalized
	note: field.string(), // yours alone; no code path machine-writes it
	stage: field.select(['new', 'understood', 'usable']), // the one acquisition dial
	createdAt: field.instant(), // panel sort key, newest first
});
export type Term = InferTableRow<typeof termsTable>;
// conversations stays exactly as imported from @epicenter/chat (not forked).
```

Stage semantics: `new` = saved because you did not know it (the save default); `understood` = you comprehend it when you read or hear it; `usable` = you can produce it. The derived progress surface is `usable: N` (replaces `known: N`).

Greenfield clean break: the workspace table key becomes `terms` and `words` is dropped. Nothing outside `apps/vocab` imports `@epicenter/vocab`; any words captured since `de5a8fe3a2` are orphaned, which is acceptable pre-release.

### Fields considered and rejected

| Candidate | Why rejected |
| --- | --- |
| `gloss` + dictionary | No stored meanings, no CC-CEDICT. The chat answers "what does this mean"; `note` holds your own handle on it. Revisit trigger below. |
| `notes` (AI-owned, overwritten) | The old harvest field. Ownership landmine below; if tutor annotation returns it is a new field added by migration. |
| `lastPracticedAt` | Deferred to the harvest phase as an additive migration, unchanged in intent (stamp only terms that actually appeared). |
| `source` / conversation provenance | Newly tempting with selection capture; refused until someone actually asks "where did I save this from". Then: one conversation-id column, additive. |
| lemma / normalized form | `text` is verbatim; a canonical form is derived data with no consumer. |
| `updatedAt` | No consumer. |
| `dueAt`, counters, `language`, tags/decks, mode fields | Carried refusals from the original design; see the refusals block. |

### The note ownership landmine

The old spec's `notes` was AI-owned and overwritten at every harvest. The new `note` is human-owned and durable. Same-looking name, opposite owner. The rule, stated once and forever: **the AI never writes `note`.** When the harvest phase lands, tutor output goes in a new field (its own migration), and the approval gate applies to it there. Any code path that machine-writes `note` is a bug, including "helpful" prefill, with one named exception below.

Revisit trigger for glosses: if the user routinely pastes dictionary definitions into `note`, that is evidence a prefill earns itself. The fix is a save-time prefill **into `note`** (still human-owned and editable after prefill), never a second meaning field.

## Capture

Select text inside a settled assistant message, then explicitly save it (a small "Save term" affordance near the selection; never auto-save on select). Saving trims the selection, dedupes by exact `text` match (a duplicate save is a no-op), and creates `{ text, note: '', stage: 'new' }`. Manual quick-add in the panel stays as the escape hatch.

This deletes the tap plumbing: `onTermTap` / `termActionLabel` through `markdown.svelte`, `markdown-node.svelte`, and `ruby.svelte`; `Segment.term` in `romanizer.ts`; the term stamps in `pinyin.ts`; and the `termsOnlyRomanizer` workaround in `ConversationView.svelte` (with tap gone, `showReadings=false` returns to plain `identityRomanizer`). Verify by grep that vocab is the only consumer before deleting.

## Implementation Plan

### Wave 2: terms rename + selection capture (replaces Phase 1)

- [ ] **2.1** `vocab.ts`: replace `WordId`/`generateWordId`/`wordsTable`/`Word` with `TermId`/`generateTermId`/`termsTable`/`Term`; workspace table key `terms`, drop `words`.
- [ ] **2.2** Delete `apps/vocab/src/lib/gloss.ts` and all `glossFor` call sites.
- [ ] **2.3** `words.svelte.ts` -> `terms.svelte.ts`: `termsState` with `terms` (createdAt desc), derived `usableCount`, `save(text)`, `setStage`, `setNote`, `remove`.
- [ ] **2.4** Selection capture in `ConversationView.svelte`; delete the tap plumbing listed above.
- [ ] **2.5** `WordsPanel.svelte` -> `TermsPanel.svelte`: heading "Terms"; rows show text (static), note (editable, commit on blur), stage cycle button (`new -> understood -> usable -> new`); `usable: {n}` count; empty state "Select text in the chat to save it as a term."
- [ ] **2.6** Delete the stray transcript `apps/vocab/2026-07-02-180606-*.txt`; update pinyin tests that reference term stamps.

### Future phases (the loop, re-expressed)

The select/compile/harvest vision survives with stage vocabulary:

```txt
select  : pure fn over stored fields; focus = `understood` terms (push toward
          usable) plus a few `new`, least-recently-practiced first once
          lastPracticedAt exists
compile : persona + focus terms (text, your note, stage) + ephemeral intent
harvest : AI reports used / only-seen / never-came-up; stamps lastPracticedAt
          only on terms that appeared; proposes stage changes you approve;
          writes its read into a NEW tutor field, never `note`
```

Keystone unchanged: nondeterminism at write time (gated, typed, approved), determinism at read time. The write machinery already exists (`invokeAction` + `Value.Check`, `createLocalToolCatalog`, ADR-0044 gating; `apps/tab-manager` is the in-app precedent).

## What this refuses (and must keep refusing)

```txt
no stored gloss / dictionary / CC-CEDICT   (the chat answers "what does this mean";
                                            prefill-into-note is the only revisit path)
no AI-writable `note`                       (tutor output = a NEW field, gated)
no source / provenance column               (until "where did I save this" is a real ask)
no lemma or normalized form beside `text`   (verbatim, trimmed, done)
no SRS scheduler / FSRS / SM-2              (no grade exists in a conversation)
no stored dueAt / review intervals          (the schedule is a pure function)
no exposure / production counters           (false-precise; no consumer)
no streaks, no due-count                    (coercion that breeds dodge-the-word laziness)
no introduce/expose/elicit mode fields      (the AI tutor decides per term)
no `language` column                        (Chinese is a constant until romanizer #2)
no tags / decks                             (single pool; `tags: string[]` is a clean
                                             additive migration if grouping is ever real)
no `updatedAt`
```

Promote the durable ones to an ADR when the work lands.

## Success Criteria

- [ ] Selecting text in a settled assistant message and clicking "Save term" creates a term with `stage: 'new'`; saving the same text again is a no-op.
- [ ] The Terms panel lists newest first; note edits persist on blur; the stage button cycles and persists; `usable: N` climbs as terms graduate.
- [ ] Pinyin rendering and the pinyin toggle behave exactly as before; no tap targets remain in rendered markdown.
- [ ] `packages/ui/src/markdown` no longer exports `Segment.term`, `onTermTap`, or `termActionLabel`, and no other consumer breaks (grep-verified).
- [ ] No gloss, dictionary, SRS, counters, or provenance code exists anywhere in `apps/vocab`.
- [ ] `bun run check` passes.

## References

- `apps/vocab/vocab.ts` - workspace contract; the terms table lives here (wire contract for sync).
- `apps/vocab/src/lib/state/words.svelte.ts` - Phase 1 state to rename/rework.
- `apps/vocab/src/routes/components/ConversationView.svelte` - selection capture site; tap plumbing removal.
- `apps/vocab/src/routes/components/WordsPanel.svelte` - panel to rename/rework.
- `packages/ui/src/markdown/` - shared renderer; loses the tap seam, keeps `Romanizer`/`Segment`/readings.
- `packages/workspace/src/shared/actions.ts`, `packages/workspace/src/agent/*` - gated-write machinery for the future harvest phase.
- 2026-07-02 terminology audit (this rewrite's source): exported at repo root `2026-07-02-210224-*.txt` until the wave lands, then delete the export.
