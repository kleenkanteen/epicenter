---
name: writing-voice
description: 'House voice for substantial prose: clear, direct, natural, and read-aloud friendly. Use for voice passes, tone work, rewrites, or prose that sounds corporate or AI-shaped.'
metadata:
  author: epicenter
  version: '1.1'
---

# Writing Voice

## Write for the Ear

Compose prose as speech the writer would naturally say and stand behind.
Preserve their cadence, vocabulary, emotional temperature, and strength of
claim.

This skill owns house voice, punctuation judgment, and anti-AI prose. Other writing skills own artifact shape, not a competing voice.

## Composition

Use the artifact skill for artifact-specific best practices: [technical-articles](../technical-articles/SKILL.md), [pull-request](../pull-request/SKILL.md), [documentation](../documentation/SKILL.md), [github-issues](../github-issues/SKILL.md), or [notebook-explanation](../notebook-explanation/SKILL.md). Use [references/discord-voice.md](references/discord-voice.md) for casual team chat.

| Skill | Owns |
| --- | --- |
| [notebook-explanation](../notebook-explanation/SKILL.md) | Live-understanding explanation posture for complicated code and systems. |
| [technical-articles](../technical-articles/SKILL.md) | Public article shape: title as argument, opening, rhythm between prose and code, section claims, closing. |
| [pull-request](../pull-request/SKILL.md) | PR title, PR body, changelog, issue links, merge strategy, durable reviewer context. |
| [documentation](../documentation/SKILL.md) | Folder READMEs, JSDoc, and comments that explain why rather than restating code. |
| [github-issues](../github-issues/SKILL.md) | Public issue and PR-thread replies with maintainer context. |
| [references/discord-voice.md](references/discord-voice.md) | Casual team chat and Discord messages. |

For PRs and commits, keep the prose clear and direct. Product and personal-voice guidance belongs to public writing, not reviewer-facing PRs or commits.

## Ear Pass

After the draft has a coherent shape, read it at speaking speed.

1. Mark where the rhythm catches, the language turns generic, or the sentence
   becomes something the writer would not naturally say or stand behind.
2. Revise the marked passages while preserving the writer's vocabulary,
   emotional temperature, and strength of claim. Keep intentional roughness or
   unusual phrasing when smoothing it would make the prose less recognizable.
3. Stop when the prose sounds natural and specific, not merely smooth.

## Default Style

- Vary sentence length. Short sentences punch; longer ones carry nuance.
- Respect the reader's time. Give the answer, then explain why.
- Assume competence. Do not over-explain fundamentals.
- Present trade-offs honestly. Do not pretend a choice is perfect.
- Avoid emojis in headings and formal content unless explicitly requested.

## Punctuation

Use punctuation to clarify, not decorate.

Prefer periods first. Use colons for explanations, semicolons for related independent clauses, parentheses for asides, and commas for short qualifiers.

Avoid en dash characters (`U+2013`). Default away from em dash characters (`U+2014`); use one only for a real interruption, appositive, or high-emphasis aside. In UI strings, headings, docs tables, commit messages, comments, and JSDoc, use a period, colon, semicolon, comma, or parentheses instead.

When in doubt, use a period.

## AI Dead Giveaways

Watch for bold formatting everywhere, everything as bullets, marketing words, template headers, vague superlatives, dramatic hyperbole, AI adjectives, space-hyphen-space punctuation, overused fragments, staccato buildup, and forced specificity.

## Common Rewrite Moves

Use these mechanical substitutions:

| If you wrote | Rewrite to |
| --- | --- |
| It is important to note that X | X |
| In order to achieve Y, we need to Z | Z gives us Y |
| The reason this works is because | This works because |
| What this means is that | State it directly |
| Basically, X | X |
| This allows us to | We can now, or say what now works |
| We need to make sure that | X must, or just do it |
| Going forward, we will | Next, or describe the action |
| leverage or utilize | use |
| facilitate | let, enable, or allow |
| implement a solution | fix it, build it, or say what changed |

## Technical Explanations

Show the mechanism, not the marketing. Lead with what happens, then why.

Good:

> Yjs with LWW timestamps gave us the best conflict resolution. We tried CRDTs without timestamps, operational transforms, and manual merge strategies; none matched it for correctness with this little code.

For architecture, auth, APIs, ownership, or design trade-offs, use [notebook-explanation](../notebook-explanation/SKILL.md) for shape. Read [references/technical-explanation.md](references/technical-explanation.md) for longer explanations, tutorials, architecture notes, or conceptual docs.
