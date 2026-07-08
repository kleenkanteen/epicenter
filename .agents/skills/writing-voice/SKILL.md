---
name: writing-voice
description: 'House voice for substantial prose: clear, direct, natural, and read-aloud friendly. Use for voice passes, tone work, rewrites, or prose that sounds corporate or AI-shaped.'
metadata:
  author: epicenter
  version: '1.1'
---

# Writing Voice

Write for the ear, not just the eyes. Prose should sound like a person explaining something to a colleague.

This skill owns house voice, punctuation judgment, and anti-AI prose. Other writing skills own artifact shape, not a competing voice.

## Composition

Use the artifact skill for artifact-specific best practices: [technical-articles](../technical-articles/SKILL.md), [pull-request](../pull-request/SKILL.md), [documentation](../documentation/SKILL.md), [github-issues](../github-issues/SKILL.md), or [notebook-explanation](../notebook-explanation/SKILL.md). Use [references/discord-voice.md](references/discord-voice.md) for casual team chat.

For PRs and commits, keep the prose clear and direct. Product and personal-voice guidance belongs to public writing, not reviewer-facing PRs or commits.

## Voice Pass

Before shipping substantial prose:

1. Read it out loud.
2. If it sounds like a press release, corporate memo, or generic AI answer, rewrite it.
3. Lead with the point.
4. Replace abstract claims with concrete mechanisms.
5. Match the user's tone and pacing.
6. Check punctuation.

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

For architecture, auth, APIs, ownership, or design trade-offs, use [notebook-explanation](../notebook-explanation/SKILL.md) for shape. Read [references/technical-explanation.md](references/technical-explanation.md) for longer explanations, tutorials, architecture notes, or conceptual docs.
