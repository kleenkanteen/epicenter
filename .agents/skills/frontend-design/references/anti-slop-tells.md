# Anti-Slop Tells

This reference catalogs recurring visual, copy, layout, state, and motion tells
that make UI feel templated.

Use these as strong defaults, not hard bans. Break one when the brief earns it
and the result is more specific, accessible, and useful.

## Default AI Visual Tells

Watch for:

- Purple or blue glow gradients without a brand reason.
- Centered hero, centered paragraph, two CTAs, then three equal feature cards.
- Glassmorphism on every surface.
- Fake dashboard screenshots made from div rectangles.
- Generic bento grids where every cell is just text on a pale card.
- Repeated split sections down the whole page.
- Decorative dots, badges, eyebrows, or meta strips on every section.
- Custom cursor effects or constant micro-animations that do not communicate state.
- Oversized H1s used instead of real hierarchy.
- Random serif words inside sans headlines just to look editorial.

## Copy Tells

Watch for:

- Filler verbs: elevate, unleash, empower, seamless, next-gen, revolutionize.
- Fake precision: 99.9%, 10x, 48k, 4.7x when no source exists.
- Generic names: Acme, Nexus, SmartFlow, Jane Doe, John Smith.
- Testimonials that sound invented or say nothing concrete.
- CTA label drift: Get started, Start now, Try it, Begin, all meaning the same thing.
- Tiny poetic labels that add mood but no information.

Prefer concrete nouns, one CTA label per intent, and copy that matches the
surface's job.

## Layout Tells

Watch for:

- Hero content that does not fit the first viewport.
- Navigation wrapping onto two desktop lines.
- CTA text wrapping inside the button.
- Long lists rendered as endless plain rows when grouping, search, or hierarchy is needed.
- Logo walls with explanatory category labels under every logo.
- Empty bento cells or cells added only to complete a grid.
- Section headers that repeat the same headline plus right-column paragraph pattern.

## State Tells

Watch for:

- Happy-path-only UI.
- Bare `Loading...` text.
- Raw spinners or skeletons instead of local primitives.
- Empty states that do not say what happened or what to do next.
- Error states that only show a toast for a persistent problem.
- Disabled controls with no visual or semantic disabled state.

## Motion Tells

Watch for:

- Motion because it looks cool, not because it communicates something.
- Multiple marquees or perpetual loops on one page.
- Scroll hijacks for ordinary content.
- Page transitions that slow down frequent app work.
- Animation that ignores reduced-motion preferences.

Motion should usually be page/view transitions, state feedback, or a clear
storytelling reveal. If the reason is not obvious, remove it.
