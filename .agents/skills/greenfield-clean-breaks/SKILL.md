---
name: greenfield-clean-breaks
description: "Greenfield clean-break review and execution for refusing unearned compatibility, collapsing old and new paths, changing public shape, moving ownership boundaries, replacing APIs, or redesigning from the ideal shape. Use when the user says greenfield, clean break, no users, no compatibility burden, refuse compatibility, remove slop, collapse this, replace the API, or asks whether old behavior can be deleted."
---

# Greenfield Clean Breaks

Use this skill when the current shape should be judged against the clearest
final system, not against the easiest incremental patch.

The job:

```txt
Name the product sentence.
Refuse unearned compatibility.
Move ownership to one place.
Replace old paths cleanly.
Verify before deletion.
```

## References

Load on demand:

- If planning a **multi-wave replacement, rollback point, or old-path deletion**, read [references/wave-ordering.md](references/wave-ordering.md).
- If drafting a **`/goal` for a greenfield or no-compatibility pass**, read [references/goal-template.md](references/goal-template.md).

## Core Loop

Run this before editing:

```txt
1. Write the product sentence.
2. Name the compatibility contracts that are real.
3. Name the owner of each important value and invariant.
4. List branches, options, fallbacks, aliases, helpers, and files that only
   preserve old shape.
5. Decide for each: break, migrate, preserve, or defer.
6. If replacing a live path, build the new path, stop importing the old path,
   verify, then delete.
7. Re-run caller counts with rg.
8. Validate with targeted tests and typecheck.
```

## Product Sentence

Write the ideal sentence first:

```txt
<noun> owns <boundary>; <caller> enters through <single path>; <runtime> does <one job>.
```

If the sentence needs "or", "also", "legacy", "fallback", or "unless old
callers", the design is probably keeping two systems alive.

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

If no contract exists, treat the old shape as removable. If a contract exists,
choose explicitly:

```txt
break     user loss is acceptable or explicitly approved
migrate   durable data or real callers need a bridge
preserve  compatibility is the product requirement
```

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

If two layers can create, repair, reinterpret, or cache the same value, choose
one owner and delete the other path.

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

Compatibility contracts:
  ...

Value owners:
  ...

Drift:
  ...

Clean break:
  ...

Deletion prize:
  ...

User loss:
  ...

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
removing behavior the user has not actually released from compatibility pressure
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
Did I stop importing the old path before deleting it?
Did verification pass before deletion?
Did I delete stale names instead of leaving aliases?
```
