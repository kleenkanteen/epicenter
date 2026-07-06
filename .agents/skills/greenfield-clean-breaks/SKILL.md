---
name: greenfield-clean-breaks
description: "Greenfield clean-break review and execution for reopening settled decisions, refusing unearned compatibility, collapsing old and new paths, moving ownership boundaries, replacing APIs, redesigning from first principles, and surfacing refusal candidates that delete disproportionate complexity. Use when the user says greenfield clean break, greenfield, clean break, no users, no compatibility burden, refuse compatibility, remove slop, collapse this, replace the API, trace upward, pressure-test the architecture, or asks whether old behavior can be deleted."
---

# Greenfield Clean Breaks

Use this skill as an operating mode, not a cleanup checklist. The current
software is evidence, not a constraint. Previously resolved decisions can be
reopened when they make the final system harder to explain, own, test, or
delete.

Two pillars:

```txt
Greenfield  Any software decision can be revised, including APIs, package
            boundaries, storage shapes, UI flows, names, dependencies, and
            prior architecture decisions.

Clean break No legacy compatibility or migration bridge is owed unless a real
            durable contract is named. Old callers, old shapes, old names, and
            old branches are deleted by default.
```

The job:

```txt
State the ideal product sentence.
Reopen inherited decisions.
Gather enough context to challenge the boundary.
Trace definitions and callers upward.
Mentally inline suspicious abstractions.
Find the small refusals that delete large code families.
Move each invariant to one owner.
Replace old paths cleanly.
Prove the new path before deleting the old one.
```

## References

Load on demand:

- If planning a **multi-wave replacement, rollback point, or old-path deletion**, read [references/wave-ordering.md](references/wave-ordering.md).
- If drafting a **`/goal` for a greenfield or no-compatibility pass**, read [references/goal-template.md](references/goal-template.md).

## Operating Stance

Be direct about weak architecture. Do not preserve a shape because it already
exists, because tests encode it, because a helper hides it, or because a prior
spec once chose it.

Treat ADRs, specs, docs, and existing code as context with different weights:

```txt
ADR or durable doc    strong evidence; may still be challenged explicitly
current code          evidence of behavior and coupling
tests                 evidence of expected behavior, not proof of good shape
spec                  in-flight scaffold, not current truth
helper abstraction    a hypothesis about ownership, not a fact
```

If the greenfield answer conflicts with an ADR or public promise, surface that
as a decision to amend, not as a reason to stop thinking.

Uncompromising does not mean careless. Break product promises only when the
user has granted that scope or the contract is not real.

## Context Gathering

Before proposing a clean break, gather enough context to make the refusal
defensible.

Run this before editing:

```txt
1. Read the narrow target.
2. Trace definitions upward: who calls it, exports it, wraps it, configures it,
   persists it, or documents it?
3. Trace values downward: who creates, mutates, repairs, caches, serializes, or
   interprets each important value?
4. Count callers and imports with rg.
5. Read the nearest tests, examples, docs, ADRs, and specs that claim the
   boundary.
6. Use subagents when available for independent context questions, especially
   caller maps, ownership maps, stale-decision searches, and forward-tests of a
   proposed clean break. Keep each subagent question bounded and pass raw
   artifacts, not conclusions.
7. If subagents are unavailable, simulate the same separation locally: write the
   question, read only the needed files, and report the evidence.
```

Evidence should name files or symbols. "Seems internal" is not evidence; caller
counts, exports, routes, schema files, docs, tests, and persisted or wire shapes
are evidence.

Do not let context gathering become permission seeking. The goal is to find
where to break cleanly, not to rationalize every existing branch.

## First-Principles Model

Write the ideal sentence first:

```txt
<noun> owns <boundary>; <caller> enters through <single path>; <runtime> does <one job>.
```

Then write the model in plain terms:

```txt
Product promise:
  What must remain true for the user?

Single owner:
  Which layer owns the value, invariant, or lifecycle?

Single entry:
  Where does the caller enter?

Single representation:
  What is the canonical shape on disk, on wire, or in memory?

Deletion prize:
  What code disappears if this model wins?
```

If the sentence needs "or", "also", "legacy", "fallback", "compat", "unless",
or "for old callers", the design is probably keeping two systems alive.

## Trace And Inline Pass

Mentally inline suspicious boundaries before accepting them.

```txt
For each wrapper/helper/service/type:
  What exact work does it do?
  What would the caller look like if this were inlined?
  Does its name still describe a real product concept?
  Does it own lifecycle, state, IO, policy, or invariants?
  Does it only preserve an old shape, smooth over bad naming, or delay a hard
  product decision?
```

Trace upward until you hit the product boundary:

```txt
local helper -> exported function -> package API -> app route/component ->
user-visible workflow -> durable contract
```

Stop early only when the owner is obvious and the deletion is local. Otherwise,
keep walking. The cleanest break is often one level above the file that first
looked wrong.

## Asymmetric Wins Pass

Before implementing, ask what can be refused.

```txt
What 10-20 percent of promised behavior creates 80 percent of the code,
testing, state, branching, compatibility, or naming complexity?

Could we refuse:
  rare modes
  fallback parsers
  provider-specific branches
  compatibility aliases
  dual readers or dual writers
  exact reproduction requirements
  optional config shapes
  second transports
  repair code in read paths
  UI affordances for invalid states
```

For each candidate refusal:

```txt
Refusal:
  ...

User loss:
  ...

Complexity deleted:
  files, branches, states, tests, docs, public names

Why this is asymmetric:
  small product loss, large implementation collapse
```

Load [asymmetric-wins](../asymmetric-wins/SKILL.md) when the refusal becomes
the center of the decision.

## Compatibility Gate

Compatibility is a product feature. Preserve old behavior only when a real
contract exists:

```txt
published package API
deployed endpoint with users
durable storage format
sync wire format
documented config shape
migration reader for existing data
explicit product promise
```

If no contract exists, delete the old shape by default. If a contract exists,
choose explicitly:

```txt
break     user loss is acceptable or explicitly approved
migrate   durable data or real callers need a bridge
preserve  compatibility is the product requirement
```

Under a clean-break instruction, prefer `break` unless the user explicitly names
the contract to preserve. Do not invent migration obligations from discomfort.
No migration, fallback, alias, dual reader, dual writer, or old call shape
survives without the same contract proof.

## Smell Catalog

Look for:

```txt
two ways to do the same thing
two owners for the same value
fallbacks beside the canonical path
repair code in read paths
optional fields preserving old shapes
compatibility aliases
dual readers or dual writers
placeholder tables or services
default rows created for hypothetical future use
public types with no real consumer
helpers that only hide product decisions
test fixtures that preserve obsolete behavior
state copied across layers for convenience
branches that exist because an invariant is checked too late
adapters that exist only because the wrong layer owns data
types that encode framework plumbing instead of product language
docs that explain two paths where one path should exist
tests that require fake lifecycle because production ownership is split
```

These are not automatically wrong. Keep one only when you can name the concrete
behavior or durable contract it preserves.

## Ownership Pass

Name one owner for every important value and invariant.

```txt
auth session       signed-in identity
route params       selected resource
database row       durable product fact
UI state           navigation choice
config file        project declaration
runtime actor      live coordination
sync engine        protocol bytes
```

Treat a value as important when it is persisted, exported, user-visible,
security-sensitive, cross-process, generated, or shared by multiple layers.

If two layers can create, repair, reinterpret, or cache the same value, choose
one owner and delete the other path.

Ownership decisions should be boring after the pass. A new caller should not
need to know history to find the right place.

## Execution Loop

When editing, keep the break clean:

```txt
1. State the product sentence and the clean-break decision.
2. Name the real compatibility contracts.
3. Name the owner of each important value and invariant.
4. List branches, options, fallbacks, aliases, helpers, files, tests, and docs
   that only preserve the old shape.
5. Decide for each: break, migrate, preserve, or defer.
6. Build the new path.
7. Stop importing the old path while leaving it on disk.
8. Verify with targeted tests, typecheck, and relevant smoke coverage.
9. Delete the old path, aliases, fixtures, examples, and docs.
10. Re-run rg for stale names, imports, and compatibility terms.
```

Read [references/wave-ordering.md](references/wave-ordering.md) for any
multi-wave replacement.

## Related Moves

- Use [asymmetric-wins](../asymmetric-wins/SKILL.md) when one small refusal may delete a large code family.
- Use [radical-options](../radical-options/SKILL.md) when the local fix is trapped inside a bad abstraction.
- Use [refactoring](../refactoring/SKILL.md) for caller counts, inlining mechanics, and straggler sweeps.
- Use [typescript](../typescript/SKILL.md) "Go-to-Definition Awareness" when
  the clean break changes TypeScript exports, aliases, wrappers, or public
  navigation across packages.

## Finding Format

```txt
Product sentence:
  ...

Evidence read:
  files, symbols, callers, tests, docs, ADRs, specs, schemas, routes

Compatibility contracts:
  ...

Value owners:
  ...

Trace upward:
  definitions, callers, exports, docs, tests, durable shapes

Reopened decisions:
  ...

Drift:
  ...

Asymmetric refusals:
  ...

Refused promise:
  ...

Clean break:
  ...

Collapse target:
  old path, alias, fallback, option, fixture, docs, tests

Remaining compatibility:
  ...

Deletion prize:
  ...

User loss:
  affected users, data, workflows, commands, or package consumers

Decision:
  break / migrate / preserve / defer because ...
```

## Stop And Ask

Pause before:

```txt
changing durable strings
deleting a published package API
changing auth or session schema
removing migration readers for existing on-disk user data
changing encryption or sync wire format
amending an ADR
deleting behavior from a published package or deployed endpoint with plausible users
deleting behavior when clean-break scope is ambiguous and contract evidence is
unclear
```

Greenfield pressure can remove product compatibility. It does not silently
break durable data formats or published contracts.

## Final Check

Ask:

```txt
Can I explain the new API without saying "or"?
Does one layer own each invariant?
Would a new caller find only one obvious path?
Are examples free of compatibility shapes?
Did I trace high enough to challenge the owner, not just the local helper?
Did I name at least one asymmetric refusal or explain why none exists?
Did I stop importing the old path before deleting it?
Did verification pass before deletion?
Did I delete stale names instead of leaving aliases?
Did docs, tests, and examples stop teaching the old shape?
```
