# Agent Skill Surface Consolidation

**Date**: 2026-07-13
**Status**: Draft
**Owner**: Braden
**Branch**: `codex/skill-surface-consolidation`

## One Sentence

Consolidate overlapping agent skills into fewer explicit owners without
rewriting, deduplicating, or removing source guidance until each later wave is
reviewed on its own.

## How To Read This Spec

Read `Preservation Contract`, `Target Shape`, and `Wave Plan` first. The
section ledgers account for the original prose heading by heading. `Source
Snapshot` records exact Git blobs so every source file can be recovered in its
original form even after the in-flight spec is deleted.

## Preservation Contract

This work separates four operations that are easy to blur together:

```txt
inventory -> verbatim relocation -> rewording and deduplication -> removal
```

Each operation lands in a separate reviewed wave. In particular:

- A verbatim relocation changes paths or ownership, not prose.
- A mechanical identity change may update a skill name, relative link, or
  command path, but does not rewrite guidance.
- Rewording happens only after the original guidance exists at its intended
  owner and the relocation diff has been approved.
- Removal happens only after retained owners validate and every source section
  has a recorded outcome.
- Git blobs preserve the exact original files. The active tree preserves only
  guidance that still changes agent behavior.

No wave is staged or committed until Braden approves its diff. Approval of one
wave does not imply approval of the next.

## Current State

Eight skills form four overlapping clusters:

```txt
agent instructions
  skill-creator
  agent-instruction-hygiene

interface design
  ui-design
  co-design
  comparable-apps

code readability
  approachability-audit

technical communication
  progress-summary
  notebook-explanation
```

The current surfaces contain 983 lines in total. Similarity alone is not the
reason to consolidate them. The relevant question is whether selecting each
skill materially steers the agent beyond stock behavior and whether one skill
owns the same move for more than one real caller.

## Target Shape

The current greenfield candidate is:

```txt
agent-instructions
  owns AGENTS.md, CLAUDE.md, project skills, placement, evaluation, and hygiene

ui-design
  owns UI direction, comparison, implementation, and component-system collapse

first-read-review
  owns the newly onboarded developer's readability pass

stock agent behavior
  owns ordinary progress recaps and live technical explanations
```

This target is not implemented by this spec commit. The names and removals
remain reviewable decisions in later waves.

## Source Snapshot

The blob hash is the exact original `SKILL.md` content at local `main` commit
`cd8c277f6f`. Recover any file with `git cat-file -p <blob>`.

| Skill | Lines | Git blob |
| --- | ---: | --- |
| `skill-creator` | 257 | `322efc502cf01635cfaf25e663779abb0a2a8cb0` |
| `agent-instruction-hygiene` | 94 | `3482225d0caad5dd37842a24d48f0e1f1f2516f5` |
| `ui-design` | 117 | `cfb25139f6b5f7f4212d06835780dd21e3a05ab7` |
| `co-design` | 81 | `3fb476318df640eea26554c39953087fed6bf635` |
| `comparable-apps` | 182 | `c1a83fbd908fb41efdef9d59bdc8b8b57c2ed4c0` |
| `approachability-audit` | 118 | `d5efe982d57033374831c720c2ea96dd03788d0b` |
| `progress-summary` | 95 | `b4ec5b3af870617b650ba277c73d6a8af5ce49cc` |
| `notebook-explanation` | 39 | `fde7d7cad94b367bf4d9933fdc07649ecb6f590e` |

`dialectic` is not on local `main`. Commit `cfe84513d9` adds it on active
feature branches with blob `f57eb7bc1d26de5846576a362e8ee90350237a8f`.
Its `Compose With` section points to `co-design`, so that integration must land
or be rerouted before `co-design` can be removed.

## Agent Instruction Ledger

### `skill-creator`

| Original section | Candidate outcome | Intended owner |
| --- | --- | --- |
| Preamble and ownership sentence | Reword later for the broader boundary | `agent-instructions/SKILL.md` |
| `Compose With` | Reconcile later; retain real domain boundaries | `agent-instructions/SKILL.md` |
| `Decide Update Or New` | Retain unchanged in the verbatim wave | `agent-instructions/SKILL.md` |
| `Supported Shape` | Retain unchanged in the verbatim wave | `agent-instructions/SKILL.md` |
| `What Not To Add` | Retain unchanged in the verbatim wave | `agent-instructions/SKILL.md` |
| `Create A Skill` | Retain unchanged in the verbatim wave | `agent-instructions/SKILL.md` |
| `Write The Description First` | Retain unchanged in the verbatim wave | `agent-instructions/SKILL.md` |
| `Use Progressive Disclosure` | Retain unchanged in the verbatim wave | `agent-instructions/SKILL.md` |
| `Evaluate A Skill` | Retain unchanged in the verbatim wave | `agent-instructions/SKILL.md` |
| `Validate With Vercel CLI` | Retain unchanged in the verbatim wave | `agent-instructions/SKILL.md` |
| `Update A Skill` | Retain unchanged in the verbatim wave | `agent-instructions/SKILL.md` |
| `Review Checklist` | Retain unchanged in the verbatim wave | `agent-instructions/SKILL.md` |
| `references/evaluation.md` | Retain unchanged | `agent-instructions/references/evaluation.md` |
| `references/composition-audit.md` | Retain unchanged before later ownership edits | `agent-instructions/references/composition-audit.md` |
| `scripts/audit-routing-collisions.ts` | Retain unchanged except mechanical command paths | `agent-instructions/scripts/audit-routing-collisions.ts` |

### `agent-instruction-hygiene`

| Original section | Candidate outcome | Intended owner |
| --- | --- | --- |
| Preamble | Move verbatim before any synthesis | `agent-instructions/references/instruction-placement.md` |
| `Compose With` | Move verbatim; reconcile duplicates later | `agent-instructions/references/instruction-placement.md` |
| `Product Sentence` | Move verbatim | `agent-instructions/references/instruction-placement.md` |
| `Placement Rules` | Move verbatim | `agent-instructions/references/instruction-placement.md` |
| `Greenfield Grill` | Move verbatim | `agent-instructions/references/instruction-placement.md` |
| `Output Shape` | Move verbatim | `agent-instructions/references/instruction-placement.md` |
| `Final Checks` | Move verbatim; deduplicate later against the main checklist | `agent-instructions/references/instruction-placement.md` |

The old `agent-instruction-hygiene` entrypoint and Claude shim stay until a
separate removal wave.

## Interface Design Ledger

### `ui-design`

| Original section | Candidate outcome | Intended owner |
| --- | --- | --- |
| Preamble and ownership sentence | Retain before later synthesis | `ui-design/SKILL.md` |
| `Canonical Path` | Retain before later synthesis | `ui-design/SKILL.md` |
| `Component-System Collapse Pass` | Retain | `ui-design/SKILL.md` |
| `Human Taste Gate` | Retain | `ui-design/SKILL.md` |
| `Product UI And Expressive Surfaces` | Retain | `ui-design/SKILL.md` |
| `References` | Retain; extend only in a later synthesis wave | `ui-design/SKILL.md` |
| `Delegation Boundaries` | Retain before later ownership edits | `ui-design/SKILL.md` |
| `Final Output` | Retain | `ui-design/SKILL.md` |
| Existing reference files | Retain unchanged | `ui-design/references/` |

### `co-design`

| Original section | Candidate outcome | Intended owner |
| --- | --- | --- |
| Preamble | Move verbatim before synthesis | `ui-design/references/direction-discovery.md` |
| `Related Skills` | Move verbatim; reconcile routing later | `ui-design/references/direction-discovery.md` |
| `Workflow` | Move verbatim | `ui-design/references/direction-discovery.md` |
| `Design Pass` | Move verbatim | `ui-design/references/direction-discovery.md` |
| `Output Shape` | Move verbatim | `ui-design/references/direction-discovery.md` |
| `Rules` | Move verbatim | `ui-design/references/direction-discovery.md` |

### `comparable-apps`

| Original section | Candidate outcome | Intended owner |
| --- | --- | --- |
| Preamble and core move | Move verbatim | `ui-design/references/comparable-apps.md` |
| `Why this skill exists` | Move verbatim | `ui-design/references/comparable-apps.md` |
| `The taxonomy` | Move verbatim | `ui-design/references/comparable-apps.md` |
| `How to apply` | Move verbatim | `ui-design/references/comparable-apps.md` |
| `Worked example: email in chrome` | Move verbatim first; review durability later | `ui-design/references/comparable-apps.md` |
| `Worked example: local model pickers (Whispering)` | Move verbatim first; candidate historical detail later | `ui-design/references/comparable-apps.md` |
| `Worked example: macOS Accessibility onboarding (Whispering)` | Move verbatim first; candidate historical detail later | `ui-design/references/comparable-apps.md` |
| `Other questions this lens answers well` | Move verbatim | `ui-design/references/comparable-apps.md` |
| `Common reveals` | Move verbatim | `ui-design/references/comparable-apps.md` |
| `Anti-patterns` | Move verbatim | `ui-design/references/comparable-apps.md` |
| `Success criteria` | Move verbatim | `ui-design/references/comparable-apps.md` |
| `What this skill is not` | Move verbatim | `ui-design/references/comparable-apps.md` |

The old `co-design` and `comparable-apps` entrypoints and Claude shims stay
until a separate removal wave.

## First-Read Review Ledger

### `approachability-audit`

| Original section | Candidate outcome | Intended owner |
| --- | --- | --- |
| Preamble and goal | Retain verbatim through a mechanical rename | `first-read-review/SKILL.md` |
| `What to Look For` | Retain verbatim | `first-read-review/SKILL.md` |
| `What Not to "Fix"` | Retain verbatim | `first-read-review/SKILL.md` |
| `Review Method` | Retain verbatim | `first-read-review/SKILL.md` |
| `Output Shape` | Retain verbatim | `first-read-review/SKILL.md` |
| `Heuristics` | Retain first; candidate for later compression | `first-read-review/SKILL.md` |
| `Go-to-Definition Is the First Read` | Retain first; deduplicate later against `typescript` | `first-read-review/SKILL.md` |
| `Success Criteria` | Retain verbatim | `first-read-review/SKILL.md` |

The rename itself is a later mechanical wave. It must update the Claude shim
and callers in `collapse-pass`, `fresh-context-review`,
`post-implementation-review`, `radical-options`, and the periodic collapse
reference without changing their surrounding prose.

## Technical Communication Ledger

### `progress-summary`

| Original section | Candidate outcome | Intended owner |
| --- | --- | --- |
| Preamble | Candidate for explicit removal | Stock agent behavior |
| `Core Principles` | Candidate for explicit removal; compare against global communication instructions first | Stock agent behavior |
| `Summary Types` | Candidate for explicit removal | Stock agent behavior |
| `What to Avoid` | Candidate for explicit removal; compare against `writing-voice` first | Stock agent behavior |
| `Gathering Context for Summaries` | Candidate for direct absorption only if another workflow requires it | Unresolved |

Before removal, reroute or remove its callers in `change-proposal` and
`handoff`. Its original `/summarize` command was deleted as unused in commit
`91ce946d72`.

### `notebook-explanation`

| Original section | Candidate outcome | Intended owner |
| --- | --- | --- |
| Preamble | Candidate for explicit removal | Stock agent behavior |
| `Explanation Posture` | Candidate for removal after direct consumers preserve any artifact-specific requirement | Stock agent behavior plus artifact owners |
| `Calibration` | Candidate for explicit removal | Stock agent behavior |
| `Composition` | Replace later with direct ownership statements in each consumer | Artifact owners |

Before removal, review `documentation`, `specification-writing`, and
`technical-articles` separately. Preserve only requirements that change those
artifacts, not general advice that stock agents already carry.

## Incoming Consumers And Shims

| Candidate old name | Current consumers outside its own file | Compatibility shim |
| --- | --- | --- |
| `skill-creator` | Textual composition references from `agent-instruction-hygiene` | `.claude/skills/skill-creator` |
| `agent-instruction-hygiene` | Textual composition references from `skill-creator` and its composition audit | `.claude/skills/agent-instruction-hygiene` |
| `ui-design` | `co-design`, `web-design-guidelines` | `.claude/skills/ui-design` |
| `co-design` | `dialectic` on commit `cfe84513d9`; textual delegation from `ui-design` | `.claude/skills/co-design` |
| `comparable-apps` | `co-design` | `.claude/skills/comparable-apps` |
| `approachability-audit` | `collapse-pass`, `fresh-context-review`, `post-implementation-review`, `radical-options`, periodic collapse reference | `.claude/skills/approachability-audit` |
| `progress-summary` | `change-proposal`, `handoff` | `.claude/skills/progress-summary` |
| `notebook-explanation` | `progress-summary`, `documentation`, `specification-writing`, `technical-articles` | `.claude/skills/notebook-explanation` |

## Wave Plan

Every wave stops for review before staging and committing.

### Wave 1: Inventory

- [x] Record exact source blobs and headings.
- [x] Record candidate owners and unresolved removals.
- [x] Record incoming callers, shims, and the unmerged Dialectic dependency.
- [ ] Review and commit this spec without changing skill content.

### Later Mechanical Waves

- [x] Rename `skill-creator` to `agent-instructions` without rewriting its body.
- [x] Rename `approachability-audit` to `first-read-review` without rewriting its body.
- [x] Copy instruction-placement guidance verbatim into its proposed final reference while leaving the old entrypoint intact.
- [x] Copy UI direction and comparison guidance verbatim into `ui-design` references while leaving old entrypoints intact.

Each bullet may become its own wave if its diff is easier to review alone.

### Later Synthesis Waves

- [ ] Reword `agent-instructions` around its broader owner boundary.
- [ ] Reword `ui-design` around direction discovery through implementation.
- [ ] Slim `first-read-review` after comparing duplicated mechanics with its cited skills.
- [ ] Decide whether any progress-summary or notebook-explanation requirement must move into a surviving owner.

### Later Removal Waves

- [ ] Remove `agent-instruction-hygiene` and its shim.
- [ ] Remove `co-design` and `comparable-apps` and their shims.
- [ ] Remove `progress-summary` and `notebook-explanation` and their shims if the reviewed steerability decision still holds.
- [ ] Remove all stale names, links, and routing claims.

### Completion

- [ ] Validate surviving skills with the Vercel skills CLI.
- [ ] Run routing-collision, duplicate-body, and dead-link audits.
- [ ] Confirm removed names have no live references.
- [ ] Run `git diff --check` for every wave.
- [ ] Record the spec outcome in `docs/spec-history.md` and delete this spent spec.

## Open Questions

1. Should the combined instruction owner be named `agent-instructions`?
   Recommendation: yes. It names the whole repository guidance surface and
   avoids colliding with the system-provided `skill-creator`.
2. Should the focused readability move be named `first-read-review`?
   Recommendation: yes. It names the actual review action more clearly than
   `approachability-audit`.
3. Should `progress-summary` and `notebook-explanation` disappear entirely from
   Epicenter?
   Recommendation: yes, unless a later consumer review finds a concrete
   repository-specific behavior that stock instructions do not provide.
4. Should the long comparable-app worked examples survive in the final active
   reference?
   Recommendation: move them verbatim first. Judge their durability only in the
   later synthesis wave.
5. How should the unmerged Dialectic commit join this branch?
   Recommendation: keep it as an explicit dependency for now. Before removing
   `co-design`, either land Dialectic first and reroute it here, or update the
   Dialectic change before it reaches `main`.

## Success Criteria

- [ ] Every original section has an approved outcome.
- [ ] Verbatim moves can be diffed against their recorded source blobs.
- [ ] No synthesis diff hides a move or deletion.
- [ ] No removal diff hides a rewrite.
- [ ] Every surviving skill has one distinct owner sentence and trigger surface.
- [ ] The final tree contains no compatibility aliases for removed skill names.
