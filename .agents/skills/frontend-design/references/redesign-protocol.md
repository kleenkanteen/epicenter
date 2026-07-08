# Redesign Protocol

Use this before changing an existing screen as a redesign, refresh, polish pass,
or visual overhaul.

## Classify The Redesign

Pick one mode before editing:

```txt
Preserve    Modernize while keeping the existing visual language, IA, copy, and habits.
Overhaul    New visual language, but existing content, routes, and product workflow still matter.
Greenfield  Reconsider visual language, content shape, and IA from first principles.
```

If the mode is unclear and it changes the work, ask one question:

```txt
Should this preserve the existing visual language, or are we starting visually from scratch?
```

## Audit First

Read the existing surface before proposing changes.

```txt
Brand and visual tokens:
  colors, type, spacing, radius, shadows, icon style, logo treatment

Information architecture:
  route, primary navigation, section order, conversion path, keyboard path

Content blocks:
  what earns its space, what is filler, what is missing

State model:
  loading, empty, error, disabled, pending, success, selected, filter-empty

Interaction model:
  click targets, keyboard access, focus states, scroll regions, responsive collapse

Patterns to preserve:
  recognizable affordances, useful copy voice, accessibility wins, muscle memory

Patterns to retire:
  generic stock imagery, repeated cards, unclear hierarchy, dead controls, AI tells,
  one-off primitives, performance traps
```

Name the audit result briefly before editing. The goal is not a report; it is to
avoid redesigning blind.

## What Not To Change Silently

Do not silently change:

- URL structure or route slugs.
- Primary nav labels.
- Form field names, order, or semantics.
- Analytics-sensitive IDs or events.
- Legal, consent, billing, or security copy.
- Brand marks or product nouns.
- Existing keyboard access, focus order, or screen-reader labels.
- Durable empty, loading, or error states.

If one of these must change, surface the tradeoff first.

## Modernization Order

Prefer the smallest change that fixes the design problem:

1. Clarify hierarchy and spacing.
2. Use the right `@epicenter/ui` primitive.
3. Improve state surfaces: loading, empty, error, disabled, selected.
4. Rework typography, density, and scan paths.
5. Recompose the hero or primary section.
6. Replace whole blocks only when the existing block is not salvageable.

## Output Shape

For non-trivial redesigns, state:

```txt
Design read:
  ...

Mode:
  preserve / overhaul / greenfield

Audit:
  what to preserve, what to retire

Plan:
  smallest set of changes that reaches the target

Pre-flight:
  light or full, plus any intentional exception
```
