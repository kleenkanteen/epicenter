---
name: frontend-design
description: 'Visual direction hub for Epicenter UI surfaces: app/product UI, dashboards, docs, marketing pages, redesigns, hierarchy, polish, anti-generic taste, and final UI pre-flight. Use when visual direction, hierarchy, polish, redesign, or the surface feel is involved. Not for tiny mechanical CSS fixes unless the fix changes the visual language.'
metadata:
  author: epicenter
  version: '2.0'
license: Complete terms in LICENSE.txt
---

# Frontend Design

Frontend design owns visual posture and the shippability bar for visible UI. It
decides what the surface should feel like; implementation mechanics belong to
`epicenter-ui`, `styling`, `svelte`, and `tanstack-table`.

Epicenter app UI should strongly prefer `@epicenter/ui` primitives. Treat
shadcn-svelte as implementation lineage and upstream grounding, not as an app
import path.

## Canonical Path

1. Read the current visual context before changing it.
2. Form the design read: audience, surface job, density, hierarchy, and visual
   language.
3. Preserve the existing visual language by default. Change it only when the
   task asks for redesign, polish, or clearer hierarchy.
4. Prefer `@epicenter/ui` primitives for Epicenter app UI.
5. Delegate mechanics to the owning skill:
   - `epicenter-ui`: component choice, local primitives, package boundaries.
   - `styling`: CSS, Tailwind, spacing, overflow, wrappers, scroll traps.
   - `svelte`: component structure, runes, lifecycle, state mechanics.
   - `tanstack-table`: table state, columns, sorting, row identity, rendering.
6. Run pre-flight before final handoff or committing visible UI changes.

For substantial or ambiguous UI work, state the design read in the chat:

```txt
Reading this as: <surface job> for <audience>, with <density and hierarchy>, preserving/changing <visual language>.
```

For tiny local repairs, keep the design read internal unless the fix changes the
visual language.

## References

Load on demand:

- Read [references/redesign-protocol.md](references/redesign-protocol.md) when a
  change alters an existing visual language, hierarchy, IA, or primary surface
  structure.
- Read [references/anti-slop-tells.md](references/anti-slop-tells.md) when
  polish, public UI, marketing/docs surfaces, portfolio-like work, or templated
  output risk is high.
- Read [references/preflight.md](references/preflight.md) before final handoff or
  committing visible UI changes. Report only failures or intentional exceptions.

## Design Read Inputs

Use these signals:

- Existing screen, neighboring screens, and local component patterns.
- Audience and surface job.
- Information density and scan path.
- Current visual language: type, spacing, radius, color, shadows, icon style,
  motion, and state treatment.
- User intent: repair, clarify, polish, redesign, explore, or ship.
- Constraints: accessibility, responsive behavior, local-first state, loading and
  empty states, performance, and implementation scope.

If the brief is ambiguous and the answer changes the design direction, ask one
clarifying question. Do not ask a questionnaire.
