# 0104. Vocab is a multilingual tutor and readings are a client-side derived view

- **Status:** Accepted
- **Date:** 2026-07-03
- **Relates:** [ADR-0102](0102-vocab-stores-verbatim-terms-under-a-human-owned-note-and-refuses-glosses-srs-and-provenance.md) (verbatim, language-blind terms: this reinforces the no-language-column refusal)

## Context

Vocab shipped Chinese-only: a bilingual Chinese-English system prompt (`VOCAB_SYSTEM_PROMPT`) and a single pinyin romanizer (`pinyin.ts`) keyed to the CJK Unicode range. Repositioning Vocab as a general-purpose multilingual tutor forced a decision about how pronunciation readings (pinyin, romaji, and so on) should work across scripts.

The design space was: store a per-term language, build a romanizer library per non-Latin script behind a script-detection router, have the tutor emit reading markup inline in its answer, or annotate a clean answer after the fact with an AI pass. Most languages a learner studies are Latin script and need no readings at all; the readings burden is concentrated in a few non-Latin scripts (Chinese today; Japanese, Korean, Thai, and others later). Chinese shares Han characters with Japanese and Korean, where the same glyph takes a different reading (今日 is `kyou` in Japanese, not the Mandarin reading of 今 + 日), so a local range-matcher cannot route a shared glyph on its own.

## Decision

- **The tutor is language-blind.** One general multilingual system prompt: it infers the studied language from the conversation and may intermix languages. There is no target-language setting and no per-term language column. ADR-0102's no-language-column refusal holds and is reinforced here, for an additional reason: the studied language is already in the text for the only mechanical consumer (romanization reads the script), and grouping the pool by language is the decks/tags machinery ADR-0102 refused.
- **Readings are a client-side derived view over clean text, never content and never conversation memory.** The tutor writes plain text; the assistant message is stored verbatim; readings are rendered on top through the existing `Romanizer = (text) => Segment[]` and `<ruby>` seam in `@epicenter/ui/markdown`, and the toggle hides them for free. Emitting reading markup inline in the answer is rejected: the message text is fed back to the model as memory on later turns, so display markup would poison future context and force stripping at the terms, harvest, and prompt boundaries.
- **Chinese readings are produced by the local, deterministic `pinyin-pro` romanizer, kept and made fail-safe.** It earns its keep as the sole live producer of readings for the current primary language, and it is instant, offline, free, and dictionary-grade. It fails safe by omission: a run carrying kana or hangul is passed through with no reading, so Han glyphs shared with Japanese or Korean never receive a Mandarin reading. A missing reading is acceptable; a wrong reading, which teaches a wrong pronunciation, is not. The accepted residual gap is a pure-Han run with no kana or hangul in the same text leaf, which still reads as Mandarin.
- **Readings for non-Chinese, non-Latin scripts are not built now.** The named extension seam is a lazy, cached, round-trip-validated AI annotation: a sibling of `harvest.ts` (settled message, one-shot `complete()`, lenient parse) that emits `[base]{reading}` parsed by a sync romanizer through the same seam, validated by stripping the readings and requiring an exact round-trip to the original text before rendering (omit when uncertain). Build it only when a non-Chinese, non-Latin script is actually being studied. No per-language romanizer library and no user-facing engine, style, or language picker is added; the only control is the Show/Hide readings toggle.

## Consequences

- Latin-script languages get no readings and need none; Chinese gets instant deterministic pinyin; Japanese, Korean, and other non-Latin scripts get no readings until the AI-annotation seam is built. This is the accepted cost of shipping the general repositioning without machinery for users who do not exist yet. Deferring the seam is free: it is a purely additive app-layer change, and the markdown seam is untouched either way.
- `@epicenter/ui/markdown` is untouched. Its `Romanizer`/`Segment`/`<ruby>` seam already serves both a synchronous local producer (pinyin-pro today) and a future synchronous parser of AI-annotated text.
- `pinyin-pro` is retained as an internal implementation detail, not a public commitment. If the AI-annotation path later covers Chinese acceptably, `pinyin-pro` may be deleted, but only on measured latency, cost, or quality need, and only guarded so it never fails unsafe.

## Considered alternatives

- **Inline reading markup in the generated answer** (`[base]{reading}` baked into message text). Rejected: assistant messages are conversation memory fed back to the model, so display markup contaminates future context and forces stripping at every boundary.
- **Per-language local romanizer libraries behind a script-detection router** (kuroshiro for Japanese, and so on). Rejected: a permanent library-per-script family plus a kana or precedence router, built before any second script is studied. The AI-annotation seam covers the whole tail with no libraries.
- **A stored per-term language column.** Rejected: the studied language is already in the text for the only consumer (romanization reads the script), grouping by language is the decks or tags machinery ADR-0102 refused, and one intermixed pool is the opposite of grouping.
- **Delete `pinyin-pro` now and AI-annotate every language including Chinese.** Rejected as the first move: it regresses the working Chinese experience (instant and deterministic to async and model-reliability-dependent) and spends per-message calls to serve absent users. The seam is additive later, so deferring costs nothing.
