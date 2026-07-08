---
name: frontend-design
description: 'Visual design direction for new or redesigned frontend surfaces: layout, typography, color, motion, and anti-generic aesthetics. Use when designing pages, dashboards, posters, marketing surfaces, or exploratory UI variations.'
metadata:
  author: epicenter
  version: '1.0'
license: Complete terms in LICENSE.txt
---

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

## Reference Repositories

- [shadcn-svelte](https://github.com/huntabyte/shadcn-svelte): Port of shadcn/ui for Svelte with Bits UI primitives
- [shadcn-svelte-extras](https://github.com/ieedan/shadcn-svelte-extras): Additional components for shadcn-svelte
- [Svelte](https://github.com/sveltejs/svelte): Svelte 5 framework

## Upstream Grounding

When a design implementation depends on Svelte behavior, use source-backed grounding before relying on memory. If DeepWiki MCP is available, ask a narrow question against `sveltejs/svelte`; for shadcn-svelte or extras component APIs, ask against `huntabyte/shadcn-svelte` or `ieedan/shadcn-svelte-extras`. If DeepWiki is unavailable or the repo is not indexed, use upstream source or official docs directly. Treat DeepWiki as orientation, then verify decisive details against local `@epicenter/ui` wrappers, installed types, source, or official docs before changing code.

Do not use upstream repos as authority for visual taste. Use them for component API and behavior only.

## Epicenter Product UI

For Epicenter product apps, the shared product system is the default design surface. Start from `@epicenter/ui`, the app's existing layout language, and the Vega/Geist theme documented in `packages/ui/README.md`. Distinctiveness should usually come from workflow fit, hierarchy, density, copy, state design, and a few purposeful app-level details, not from replacing the shared type stack or inventing decorative systems inside one screen.

Use this skill's bolder aesthetic guidance when the task is a new marketing surface, prototype, poster, landing page, explicit redesign, or isolated experience whose visual identity is the work. For routine product UI, compose local primitives first, then use visual judgment to make the surface clear and memorable within the shared system.

Before adding custom fonts, new global tokens, background effects, motion systems, or component forks to an Epicenter app, name the product reason and why `@epicenter/ui` cannot carry it. If the reason is only "make it feel designed", improve composition, spacing, information hierarchy, and empty/loading/error states first.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Refactor Fidelity

When redesigning or refactoring an existing UI, treat pixel fidelity as a
question to classify, not a default requirement. This skill owns visual
direction, hierarchy, accessibility, important states, and recognizable product
feel.

If exact spacing, breakpoints, animations, hover states, empty states, DOM shape,
full component trees, or snapshot fidelity force a large styling or state
family, switch to [asymmetric-wins](../asymmetric-wins/SKILL.md) for the refusal
decision. Return here for the visual judgment: fidelity is load-bearing when it
affects comprehension, accessibility, trust, brand, or regression-sensitive
state.

Prefer local UI primitives when they preserve the same workflow, hierarchy,
states, and accessibility contract. Do not reproduce a full HTML tree merely to
make a design artifact feel precise; use a screenshot, compact sketch, state
table, or partial tree unless exact DOM structure is the product contract or the
bug.

## Design Thinking

Before coding, understand the context and commit to a BOLD aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc. There are so many flavors to choose from. Use these for inspiration but design one that is true to the aesthetic direction.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work; the key is intentionality, not intensity.

Then implement working code (HTML/CSS/JS, React, Vue, etc.) that is:
- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

## Frontend Aesthetics Guidelines

Focus on:
- **Typography**: Choose fonts that are beautiful, unique, and interesting for standalone design work. Avoid generic fonts like Arial and Inter when the surface is meant to establish its own identity; opt instead for distinctive choices that elevate the frontend's aesthetics. In Epicenter product apps, preserve the shared Geist stack unless the task explicitly reopens product identity.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.
- **Backgrounds & Visual Details**: Create atmosphere and depth rather than defaulting to solid colors. Add contextual effects and textures that match the overall aesthetic. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, and grain overlays.

For standalone design work, never use generic AI-generated aesthetics like overused font families (Inter, Roboto, Arial, system fonts), cliched color schemes (particularly purple gradients on white backgrounds), predictable layouts and component patterns, and cookie-cutter design that lacks context-specific character.

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No standalone design should be the same. Vary between light and dark themes, different fonts, and different aesthetics. Do not converge on common choices (Space Grotesk, for example) across generations. For Epicenter product apps, the anti-generic move is usually a sharper workflow and clearer composition inside the shared system, not a new theme.

**IMPORTANT**: Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.

Remember: Claude is capable of extraordinary creative work. Don't hold back, show what can truly be created when thinking outside the box and committing fully to a distinctive vision.
