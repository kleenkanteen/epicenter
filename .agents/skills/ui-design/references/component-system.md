# Epicenter Component System

This reference covers local component choice, composition, and package
boundaries for Svelte apps using `@epicenter/ui`.

Reach for a local component before writing one-off UI. Loading, empty, pending,
error, confirm, command, and chat surfaces already have components that own
spacing, color, accessibility, and composition. Svelte decides which branch
renders; this reference decides what that branch looks like.

`packages/ui/README.md` is the source of truth for package internals: the import
boundary, `style-vega` activation, `cn-*` hooks, overlay deltas, component
ownership, and the vendored-component update workflow. Read it before changing
anything inside `packages/ui`.

## Collapse Smells

These are high-signal smells, not automatic bans:

- Arbitrary Tailwind values such as `text-[11px]`, `rounded-[7px]`,
  `max-w-[43rem]`, or other exact values outside the shared scale.
- Raw hex, RGB, or palette colors where a semantic token should own the role.
- Stray `div` wrappers whose only job is carrying layout or visual classes.
- Long class bundles that restyle a primitive's spacing, density, radius,
  typography, hover, focus, shadow, or transition budget.
- Local loading, empty, error, confirmation, tooltip, or command markup that a
  shared component already owns.
- The same visual bundle copied across screens or apps.
- One-off responsive branches, hover treatments, or animations preserved only
  to reproduce the old screen exactly.

For each smell, name the user-visible objective and compare the code with the
natural component-system composition. If the objective survives without the
custom detail, delete the detail and its wrappers instead of translating them
line for line.

An arbitrary value or custom color can survive when it owns precise geometry,
data visualization, a third-party integration constraint, or another concrete
product reason that the shared scale cannot express. Name the reason. If the
value repeats or becomes a reusable visual decision, promote it to a semantic
token, component variant, or stable primitive.

## What Earns A Custom Shape

Keep a composition in the app when it owns app-specific data, persistence,
policy, workflow, or product meaning. Its styling should still compose shared
primitives rather than rebuilding them.

Move a shape into `packages/ui` when it is stable and visual and either:

- several apps need the same product concept; or
- it owns an accessibility or interaction contract that should not be
  reimplemented locally.

Do not promote speculative reuse. Do not keep a reusable visual contract local
merely because the first consumer happened to live in one app.

## Package Boundary

App code imports public entry points such as:

```ts
import { Button } from '@epicenter/ui/button';
```

Never import from `packages/ui/src`, create aliases into it, or use the stock
`$lib/components/ui/*` path. Apps must set `class="style-vega"` on their root
element for the scoped `cn-*` rules to apply. Run `bun run check:ui-boundary`
when changing or auditing this boundary.

Import compound components as namespaces:

```ts
import * as Dialog from '@epicenter/ui/dialog';
```

Import single components by name.

## Upstream Grounding

Use source-backed grounding when behavior depends on shadcn-svelte structure,
Bits UI composition, snippets, bindable props, wrapper APIs, TanStack Table, or
the extras package. Treat upstream sources as orientation, then verify decisive
details against local wrappers, installed types, or official documentation.

Reference repositories:

- [shadcn-svelte](https://github.com/huntabyte/shadcn-svelte): component structure and Svelte composition.
- [shadcn-svelte-extras](https://github.com/ieedan/shadcn-svelte-extras): chat and extra UI patterns.
- [TanStack Table](https://github.com/TanStack/table): headless table state.
- [Autumn](https://github.com/useautumn/autumn): billing and usage UI nouns.

The local package is a pinned 1.x Vega fork. Grep `packages/ui/src` before
assuming a current upstream convention exists locally. The fork has no standalone
`Combobox`; compose `Command` in `Popover` or use `TimezoneCombobox`. It also has
no `InputOTP`. Newer upstream buttons use `data-icon="inline-start"`; the local
button predates that convention, so do not copy the upstream idiom blindly.

## Choose The Component By Job

- `Dialog` or `AlertDialog`: confirmation, yes/no, or display-only content.
- `ConfirmationDialog`: reusable simple confirmation.
- `Modal`: forms, typing, dropdowns, and multi-step input. It becomes a drawer
  on mobile.
- `Sheet` or `Drawer`: secondary panels.
- `Command` or `CommandPalette`: filtered actions and command menus.
- `Item`, `SectionHeader`, `ButtonGroup`, `InputGroup`, `CopyButton`, `Kbd`, and
  `Sidebar.*`: list rows, sections, grouped controls, copy actions, keyboard
  hints, and app chrome.
- `Field`, `Input`, `Textarea`, `Select`, `Switch`, `Checkbox`, and `RadioGroup`:
  forms and settings.
- `FileDropZone`, `NaturalLanguageDateInput`, `TimezoneCombobox`, `TreeView`, and
  `Markdown`: stable reusable product widgets.
- `LightSwitch`: shared light and dark theme control.
- `Chat.*`: chat lists, bubbles, typing, copy actions, and auto-scroll.
- `Sonner` and `toastOnError`: toasts and result-aware error notifications.

Dialog, Modal, Sheet, and Drawer need an accessible title. Use an `sr-only` title
when the visible design already supplies equivalent context.

## Waiting And Absence States

Choose by what the user is waiting for:

- Generic full-surface pending: `Loading`, with an optional descriptive label.
- Pending with title, description, media, or actions: `Empty.Root` plus `Spinner`.
- Known progress: `Progress`.
- Known content shape: `Skeleton`.
- Button action pending: disable the `Button`, add `Spinner`, and retain useful
  label context.
- Command search with no match: `Command.Empty`.
- No rows, files, results, or a failed persistent surface: `Empty.*`, with
  distinct copy for truly empty and filter-empty states.
- Chat assistant typing: `Chat.BubbleMessage typing`; `LoadingDots` is chat-only.

The common full-surface case needs no wrapper:

```svelte
<Loading class="h-dvh" label="Checking session" />
```

For inline pending, use a bare `Spinner` and add a wrapper only when no existing
element can carry the layout classes.

Never hand-roll a spinner with raw `animate-spin`, `LoaderCircleIcon`, or
`Loader2Icon`. Do not ship bare `Loading...` text or raw pulsing placeholder
blocks. Use `Spinner`, a concrete status label, and `Skeleton` respectively.

## Tooltips

`Button` and `Link` accept a `tooltip` prop:

```svelte
<Button size="icon" variant="ghost" tooltip="Delete recording" onclick={deleteRecording}>
	<TrashIcon />
</Button>
```

The prop expects a `Tooltip.Provider` above it. Compose `Tooltip.*` directly only
when the trigger is not a Button or Link, or the content is more than a label.

## Composition Ladder

Before keeping custom markup or copying component internals:

1. Use an existing component and its natural variants.
2. Delete redundant wrappers; pass only supported props or parent layout and
   product-state classes.
3. Add a shared variant or primitive when the stable visual contract meets the
   promotion threshold above.
4. Keep an app-local wrapper only for real app behavior, product meaning, or a
   composition boundary such as scroll containment, pane sizing, table
   structure, or a sticky header.
5. Copy upstream code only when Epicenter must own behavior, tokens,
   persistence, shortcuts, or application state.

Use `styling` to decide whether a wrapper is necessary and to resolve scroll
layout traps. Reconcile upstream changes against local deltas rather than
overwriting local wrappers.

Prefer local extras, including chat surfaces, before one-off equivalents.
