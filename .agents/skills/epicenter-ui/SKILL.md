---
name: epicenter-ui
description: Epicenter UI component selection and composition patterns for Svelte apps using @epicenter/ui. Use when choosing or reviewing local UI components, loading or empty states, skeletons, spinners, command empty states, action pending UI, table/list no-row states, button or link tooltips, modal/dialog/sheet/drawer surfaces, package import boundaries, wrapper minimization, or replacing ad hoc UI such as Loading... text, custom loading dots, raw animate-pulse placeholders, raw tooltip wrappers, or one-off centered status markup.
metadata:
  author: epicenter
  version: '2.0'
---

# Epicenter UI

Reach for a local `@epicenter/ui` component before writing one-off UI. Most state surfaces (loading, empty, pending, error, confirm, command, chat) already have a component that owns spacing, color, accessibility, and composition. This skill covers which local component to reach for and the conventions you cannot derive from upstream shadcn-svelte. Svelte decides which branch renders; this skill decides what the branch looks like.

- Use `svelte` for branch mechanics: `{#if}`, `{#await}`, derived state, query state, lifecycle.
- Use `styling` for Tailwind details, whether a wrapper element is needed, scroll traps, and disabled-state styling.

`packages/ui/README.md` is the source of truth for the package internals: import boundary, `style-vega` activation, `cn-*` style hooks, overlay deltas, and the vendored-component update workflow. Read it before changing anything inside `packages/ui`.

## Package Boundary

App code imports the public API, such as `import { Button } from '@epicenter/ui/button'`. Never import from `packages/ui/src`, never add aliases that reach into it, and never use the stock `$lib/components/ui/*` path. Apps must set `class="style-vega"` on their root element or the scoped `cn-*` rules do not apply. `scripts/check-ui-boundary.ts` owns and enforces this boundary; run `bun run check:ui-boundary` if unsure.

Import compound components as namespaces (`import * as Dialog from '@epicenter/ui/dialog'`); import single components by name (`import { Button } from '@epicenter/ui/button'`).

## Reference Repositories

- [shadcn-svelte](https://github.com/huntabyte/shadcn-svelte): component structure and Svelte composition patterns
- [shadcn-svelte-extras](https://github.com/ieedan/shadcn-svelte-extras): chat components and extra UI patterns
- [TanStack Table](https://github.com/TanStack/table): headless table state, not table empty UI
- [Autumn](https://github.com/useautumn/autumn): billing and usage UI where pending, progress, and empty states matter

## Upstream Grounding

When local `@epicenter/ui` behavior depends on shadcn-svelte component structure, Bits UI composition, snippets, bindable props, or wrapper APIs, use source-backed grounding before relying on memory. If DeepWiki MCP is available, ask a narrow question against `huntabyte/shadcn-svelte`; for extras components, ask against `ieedan/shadcn-svelte-extras`; for table state, ask against `TanStack/table`; for billing UI nouns, ask against `useautumn/autumn`. If DeepWiki is unavailable or the repo is not indexed, use upstream source or official docs directly. Treat DeepWiki as orientation, then verify decisive details against local wrappers, installed types, source, or official docs before changing code.

Upstream shadcn-svelte is the authority for component API and behavior, but `packages/ui` is a pinned 1.x Vega fork, so verify version-sensitive conventions against the local component source before applying them. For example, newer upstream buttons space icons with a `data-icon="inline-start"` attribute; the vendored button predates that and has no `data-icon`, so grep `packages/ui/src` before trusting a fresh upstream idiom. The fork also ships no standalone `Combobox` (compose `Command` in `Popover`; see `timezone-combobox`) or `InputOTP`, though upstream documents both.

Skip DeepWiki for the local conventions documented below.

## Which Local Component

Reach for the component whose contract matches the job. Several have no upstream equivalent and exist only here: `Loading`, `ConfirmationDialog`, `Modal`, `CommandPalette`, `Chat.*`, `Item`, `SectionHeader`, and `Sidebar.*`.

Surfaces:

- `Dialog` or `AlertDialog`: confirmations, yes/no prompts, display-only content.
- `ConfirmationDialog`: reusable simple confirmation before hand-rolling alert-dialog markup.
- `Modal`: forms, typing, dropdowns, multi-step input. Renders as a dialog on desktop and a drawer on mobile.
- `Sheet` or `Drawer`: secondary panels and side surfaces.
- `Command` or `CommandPalette`: command menus and filtered actions.
- `Item`, `SectionHeader`, `ButtonGroup`, `InputGroup`, `CopyButton`, `Sidebar.*`: list rows, page sections, grouped controls, inline input actions, copy actions, app chrome.

Dialog, Modal, Sheet, and Drawer need an accessible title. Use an `sr-only` title when the visual design already supplies equivalent context.

Waiting and absence states, chosen by what the user is waiting for:

- Generic full-surface pending, spinner plus optional caption: `Loading` (it wraps `Empty.Root` plus `Spinner` and accepts sizing `class`, so it usually needs no outer `div`).
- Full-surface pending that needs a title, description, media, or actions: compose `Empty.Root` with `Spinner`.
- Known progress: `Progress`.
- Known content shape: `Skeleton`.
- Button action pending: disable the `Button` and put a `Spinner` inside it; keep the label when the action needs context.
- Command search with no match: `Command.Empty`.
- No rows, files, or results, or a failed surface: `Empty.*`, with different copy for truly-empty versus filter-empty. TanStack Table is headless, so render `Empty.*` yourself when `rows.length === 0`.
- Chat assistant typing: `Chat.BubbleMessage typing` (`LoadingDots` is chat-only).

## Never Hand-Roll A Spinner

Use `Spinner` for every spinning affordance. Do not put raw `animate-spin`, `LoaderCircleIcon`, or `Loader2Icon` in app code: the local `Spinner` owns the size, color token, and animation. This is the most common local UI violation. Do not print bare `Loading...` text either; pair status text with a `Spinner` and say what is happening (`Checking session`, `Downloading model`).

Do not drop raw `animate-pulse` content placeholders; use `Skeleton`. An intentional pulsing status dot is fine; a fake-content placeholder block is not.

## Tooltips

`Button` and `Link` take a `tooltip` prop. Use it instead of hand-wrapping `Tooltip.Root`, `Tooltip.Trigger`, and `Tooltip.Content`:

```svelte
<Button size="icon" variant="ghost" tooltip="Delete recording" onclick={deleteRecording}>
	<TrashIcon />
</Button>
```

The prop expects a `Tooltip.Provider` somewhere above the trigger. Hand-roll `Tooltip.*` only when the trigger is not a `Button` or `Link`, or the content is not a simple label.

## Composition Ladder

Before copying or forking component internals, escalate in order:

1. Use an existing local component and its variants.
2. Pass a `class` or supported prop.
3. Add a local variant to the wrapper component.
4. Wrap the component for a real composition boundary (scroll containment, pane sizing, table cell structure, sticky header).
5. Copy upstream component code only when Epicenter needs to own behavior, tokens, persistence, shortcuts, or app state.

For whether a wrapper element is needed at all, and for scroll-layout traps, defer to `styling`. Before pulling upstream component updates, commit local wrapper state, then reconcile upstream changes against local deltas instead of overwriting the wrapper.

## Extras And Chat

Prefer existing local extras (copy buttons, snippets, links, chat) before one-off equivalents; chat list, bubble variants, typing, copy actions, and auto-scroll live in local wrappers, so compose them rather than duplicating their internals. Copy a small generic primitive into `packages/ui` only when it is stable and visual; wrap instead when Epicenter adds domain behavior or persistent app state.

## Avoid

The positive rules above cover the common mistakes. Two structural traps are easy to fall into from generic shadcn-svelte habits and are worth naming on their own:

- App imports from `packages/ui/src` or the stock `$lib/components/ui/*` path. Import through `@epicenter/ui/*`.
- Copying shadcn-svelte or extras component internals into an app instead of importing the local wrapper, or forking past step 5 of the composition ladder.
