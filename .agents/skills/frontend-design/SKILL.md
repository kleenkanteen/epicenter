---
name: frontend-design
description: 'Visual direction hub for Epicenter UI surfaces: app/product UI, dashboards, docs, marketing pages, redesigns, hierarchy, polish, anti-generic taste, and final UI pre-flight. Use when visual direction, hierarchy, polish, redesign, or the surface feel is involved. Not for tiny mechanical CSS fixes unless the fix changes the visual language.'
metadata:
  author: epicenter
  version: '2.0'
license: Complete terms in LICENSE.txt
---

# Frontend Design

Frontend design owns visual posture and the shippability bar for visible UI. It decides what the surface should feel like; implementation mechanics belong to `epicenter-ui`, `styling`, `svelte`, and `tanstack-table`.

Epicenter app UI should strongly prefer `@epicenter/ui` primitives. Treat shadcn-svelte as implementation lineage and upstream grounding, not as an app import path.

## Canonical Path

1. Read the current visual context before changing it.
2. Form the design read: audience, surface job, density, hierarchy, and visual language.
3. Preserve the existing visual language by default. Change it only when the task asks for redesign, polish, or clearer hierarchy.
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

For tiny local repairs, keep the design read internal unless the fix changes the visual language.

## Epicenter Product UI

For Epicenter product apps, the shared product system is the default design surface. Start from `@epicenter/ui`, the app's existing layout language, and the Vega/Geist theme documented in `packages/ui/README.md`. Distinctiveness should usually come from workflow fit, hierarchy, density, copy, state design, and a few purposeful app-level details, not from replacing the shared type stack or inventing decorative systems inside one screen.

Use this skill's bolder aesthetic guidance when the task is a new marketing surface, prototype, poster, landing page, explicit redesign, or isolated experience whose visual identity is the work. For routine product UI, compose local primitives first, then use visual judgment to make the surface clear and memorable within the shared system.

Before adding custom fonts, new global tokens, background effects, motion systems, or component forks to an Epicenter app, name the product reason and why `@epicenter/ui` cannot carry it. If the reason is only "make it feel designed", improve composition, spacing, information hierarchy, and empty/loading/error states first.

## References

Load on demand:

- Read [references/redesign-protocol.md](references/redesign-protocol.md) when a change alters an existing visual language, hierarchy, IA, or primary surface structure.
- Read [references/anti-slop-tells.md](references/anti-slop-tells.md) when polish, public UI, marketing/docs surfaces, portfolio-like work, or templated output risk is high.
- Read [references/preflight.md](references/preflight.md) before final handoff or committing visible UI changes. Report only failures or intentional exceptions.

## Refactor Fidelity

## Design Read Inputs

Use these signals:

- Existing screen, neighboring screens, and local component patterns.
- Audience and surface job.
- Information density and scan path.
- Current visual language: type, spacing, radius, color, shadows, icon style, motion, and state treatment.
- User intent: repair, clarify, polish, redesign, explore, or ship.
- Constraints: accessibility, responsive behavior, local-first state, loading and empty states, performance, and implementation scope.

If the brief is ambiguous and the answer changes the design direction, ask one clarifying question. Do not ask a questionnaire.

## Design Thinking

Before coding, understand the context and commit to a bold aesthetic direction:

- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick a clear direction: brutally minimal, maximalist chaos, retro-futuristic, organic, luxury, playful, editorial, brutalist, art deco, soft, industrial, or another direction that fits the context.
- **Constraints**: Technical requirements, performance, accessibility, and product system boundaries.
- **Differentiation**: What makes this memorable? What is the one thing someone will remember?

Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work; the key is intentionality, not intensity.

Then implement working code that is:

- Production-grade and functional.
- Visually striking and memorable.
- Cohesive with a clear aesthetic point of view.
- Meticulously refined in every detail.

## Frontend Aesthetics Guidelines

Focus on:

- **Typography**: Choose fonts that are beautiful, unique, and interesting for standalone design work. Avoid generic fonts like Arial and Inter when the surface is meant to establish its own identity. In Epicenter product apps, preserve the shared Geist stack unless the task explicitly reopens product identity.
- **Color and theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly distributed palettes.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals creates more delight than scattered micro-interactions.
- **Spatial composition**: Unexpected layouts, asymmetry, overlap, diagonal flow, grid-breaking elements, generous negative space, or controlled density.
- **Backgrounds and visual details**: Create atmosphere and depth rather than defaulting to solid colors. Use gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, and grain overlays when they fit the aesthetic.

For standalone design work, never use generic AI-generated aesthetics like overused font families, cliched color schemes, predictable layouts, cookie-cutter component patterns, or decorative choices that lack context-specific character.

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No standalone design should be the same. Vary between light and dark themes, different fonts, and different aesthetics. Do not converge on common choices across generations. For Epicenter product apps, the anti-generic move is usually a sharper workflow and clearer composition inside the shared system, not a new theme.

Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.

Remember: Claude is capable of extraordinary creative work. Do not hold back when the task is explicitly asking for distinctive visual identity.
