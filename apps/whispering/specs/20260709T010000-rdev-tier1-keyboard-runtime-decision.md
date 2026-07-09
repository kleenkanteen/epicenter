# Decision memo: does Whispering's rdev / Tier-1 keyboard runtime earn its keep?

- **Status:** In Progress
- **Date:** 2026-07-09
- **Decision:** Settled. Braden approved refusing Tier-1 input entirely, including
  macOS Fn / modifier-only holds. Global shortcut input is plugin chords on every
  platform; the macOS `CGEventTap` survives only as the Accessibility-grant watcher
  for auto-paste-at-cursor. Recorded as **ADR-0117 (Proposed)**; this spec is its
  evidence and execution plan and is deleted when the wave lands.
- **Scope:** Whispering desktop keyboard runtime. Decide whether the raw keyboard
  tap (rdev off macOS, owned `CGEventTap` on macOS) and the Tier-1 gestures it
  enables (Fn holds, modifier-only holds, raw push-to-talk) earn their keep, or
  whether Whispering should refuse them and rely only on
  `tauri-plugin-global-shortcut` chords.
- **Relates:** ADR-0008 (rdev backs the desktop global trigger), ADR-0011 (Rust
  owns the macOS dictation capability), ADR-0019 (permission-free Tier-0 floor,
  Accessibility opt-in Tier-1), ADR-0020 (macOS drives an owned CGEventTap, not
  rdev), ADR-0040 (a cursor write that cannot paste falls back to the clipboard,
  decided from the grant), ADR-0052 (reach model).
- **Decision owner:** Braden. This memo does not authorize any deletion.

## The one-sentence reframe

"Tier-1" is not one capability, it is two capabilities wearing one tap, and they
have **opposite verdicts**:

1. **Tier-1 input** — binding a gesture the plugin cannot express (bare Fn hold,
   modifier-only hold, raw push-to-talk) and having the tap capture and fire it.
2. **The macOS tap-as-paste-oracle** — the same tap's liveness produces the
   `Broken`-aware `DictationCapability` that `write_text` gates auto-paste-at-cursor
   on (`lib.rs:406-409`). This exists **only on macOS** (`lib.rs:411-412` makes
   non-macOS paste unconditional).

Every "should we delete the tap" question dissolves once you separate these. The
input capability is weak-to-dead and mostly unproven. The paste-oracle is
load-bearing and macOS-only. So the honest answer is a split, not a verdict.

## Decision (settled)

**Refuse Tier-1 input as a product surface on every platform, including macOS Fn /
modifier-only holds. Global shortcut input is `tauri-plugin-global-shortcut`
chords only. The macOS `CGEventTap` survives solely as the Accessibility-grant
watcher for auto-paste-at-cursor, not as a shortcut backend.** Recorded as
ADR-0117 (Proposed).

The macOS Fn live proof is **not** run: "hold Fn like the native dictation key" is
not a core product promise, and chord hold-to-talk preserves the workflow without
owning raw global input. If it is ever promoted to a core promise, reopen with a
proof and a macOS-only ADR.

| Move | Verdict |
|---|---|
| Delete the **non-macOS rdev backend** (`rdev` dep, `rdev_map.rs`, the `#[cfg(not(macos))]` listen path, the Wayland-apology surface) | **Delete** |
| Refuse the **macOS Fn / modifier-only input** (matcher gesture layer, `set_bindings`/`set_capturing`, tap recorder, trigger/capture events) | **Delete** |
| Keep the **macOS `CGEventTap` + supervisor + `DictationCapability`** as the auto-paste `Broken`-oracle | **Keep**, re-scoped |
| Keep the **auto-paste stale-grant behavior** (`write_text` gate on `capability() == Active`, `Broken` → `LeftOnClipboard`) | **Keep unchanged** — the invariant and acceptance gate |

## Product promise: preserved vs refused

**Preserved (the product sentence stays true):**
"Global dictation is available from a running Whispering via a normal keyboard
chord, and the transcript pastes where your cursor is."

- Default toggle `Cmd/Ctrl+Shift+Space` and cancel `Cmd+.` are already Tier-0
  chords through the plugin (`device-config.svelte.ts:45-56`). No Accessibility.
- **Chord hold-to-talk survives.** The plugin delivers both edges: the installed
  crate types `ShortcutEvent.state` as `'Pressed' | 'Released'`
  (`tauri-plugin-global-shortcut-2.3.2/guest-js/index.ts:13-17`, backed by
  `global-hotkey-0.8.0` `HotKeyState { Pressed, Released }`), and the Tier-0 path
  already dispatches `event.state` into the command layer
  (`tauri.tauri.ts:396-397`). A user can hold `Cmd+Shift+Space` to talk with no
  tap at all.
- Auto-paste-at-cursor survives on macOS (the tap stays as its oracle).

**Refused (the small promise we give up):**
"Hold a **bare Fn key**, or hold **only modifiers** (no regular key), as a global
push-to-talk gesture — on Windows and Linux."

- Off macOS this promise is already largely false (see evidence table) and has no
  live proof anywhere.
- Push-to-talk, the **only** command that is release-sensitive
  (`commands.ts:78`, every other command is `on: ['Pressed']`), ships **unbound**
  (`DEFAULT_GLOBAL_BINDINGS.pushToTalk = null`). A stale comment at
  `commands.ts:77` claims a default Fn key; the shipped default contradicts it.

## Evidence table

Backends per platform: macOS runs an owned `CGEventTap` (`mac_tap.rs`), every
other desktop runs `rdev::listen` via `rdev_map` (`mod.rs:272-285`). Exactly one
compiles per platform. rdev the crate is a real code dependency **only** in
`rdev_map.rs` (`classify(key: rdev::Key)`) and the non-macOS `mod.rs` listen
block; `mac_tap.rs` is self-contained (its own transcribed `kVK_*` table), and
`matcher.rs` "never sees an `rdev::Key`" (`matcher.rs:15`).

| Platform | Backend | Bare Fn hold | Modifier-only hold | Chord (Tier-0) | Paste-oracle role | Live runtime proof |
|---|---|---|---|---|---|---|
| **macOS** | owned `CGEventTap` | Code path exists (`mac_tap.rs:204` keycode 63 + `CGEventFlagSecondaryFn`; unit test `:332`) | Code path exists | Yes, via plugin | **Yes** — gates auto-paste (`lib.rs:406-409`) | **None found.** No end-to-end evidence Fn-hold actually fires dictation in a signed build. |
| **Windows** | `rdev::listen` | **Dead** — no `Function` entry in `rdev` Windows keycode map (`windows.rs`) | Works — rdev maps modifier keys (`windows.rs:84-90,123-128`) | Yes, via plugin | None (`lib.rs:411-412`, `can_paste = true`) | None found |
| **Linux X11** | `rdev::listen` | **Dead** — no `Function` entry in `rdev` Linux keycode map (`linux.rs`) | Works — rdev maps modifier keys (`linux.rs:30-36,67-73`) | Yes, via plugin | None | None found |
| **Linux Wayland** | `rdev::listen` | **Unsupported** — `listen` is X11-only (`rdev/src/lib.rs:39-40`); app ships a "Global shortcuts need an X11 session" apology (`DictationCapabilityNotice.svelte:78-88`) | Unsupported | Yes, via plugin | None | N/A |

Reading of the table: **off macOS, the tap's entire justification is "modifier-only
holds on X11," unproven and behind a niche, unbound-by-default command, while it
carries a dead Fn promise, a Wayland dead-zone, and a class of "global shortcut
stopped working" support burden.** On macOS the tap earns its keep on the *output*
side regardless of whether the *input* side is ever proven.

## "rdev earns its keep if…"

The non-macOS rdev backend earns its keep only if **all** of these become true.
Today none are.

1. A shipped, **bound-by-default** gesture on Windows/Linux needs a hold the
   plugin cannot express — i.e. a modifier-only or Fn hold, not a chord hold.
2. That gesture has **live runtime proof** on the target platform, not just a
   keycode-map entry.
3. The gesture is worth owning a raw global keyboard listener plus its liveness,
   restart, and (on X11) session-type handling.
4. It cannot be served by a Tier-0 chord hold instead (which already works).

The macOS `CGEventTap` earns its keep on a **different** and already-satisfied
criterion: it is the only reliable `Broken`-vs-`Active` oracle for auto-paste
(ADR-0040 established you cannot observe a synthetic ⌘V's failure; the tap-death
signal is the substitute). It keeps that value even if criteria 1-4 stay false.

## Deletion map (delete / keep / split)

Assuming the recommended split (delete non-macOS rdev; keep macOS tap as paste
oracle; macOS Fn-input pending proof). "Split" = the file survives but loses its
gesture-input half.

### Rust — `src-tauri/src/keyboard/*`

| File | Under recommendation | If macOS Fn-input is ALSO dropped | If auto-paste is ALSO refused |
|---|---|---|---|
| `rdev_map.rs` | **Delete** (non-macOS only) | Delete | Delete |
| `mod.rs` `#[cfg(not(macos))]` listen block (`:272-285`) | **Delete** | Delete | Delete |
| `mac_tap.rs` | **Keep** (paste oracle) | Split: keep the bare tap for liveness, delete the Fn keycode-63 decode + gesture normalization | Delete |
| `supervisor.rs` | **Keep** (publishes `DictationCapability`) | Keep (auto_paste intent still needs it) | Delete |
| `mod.rs` `TapController` | **Keep**, shrink | Split: drop `set_bindings`/`set_capturing`, keep `capability()` + `set_auto_paste_enabled` | Delete |
| `matcher.rs` (22 KB) | Keep only if macOS Fn-input stays | **Delete** — pure gesture-to-trigger conversion, plugin bypasses it | Delete |
| `event.rs` | Keep `DictationCapabilityEvent`; `ShortcutTrigger/CaptureEvent` only if macOS input stays | Split | Delete |
| `keys.rs` | Keep the `KeyBinding` model (settings still store structured bindings) | Keep (binding storage) | Reassess |
| `commands.rs` | Keep `get_dictation_capability`, `set_auto_paste_enabled`; drop `set_keyboard_shortcuts`/`set_keyboard_capturing` if macOS input goes | Split | Delete |

`Cargo.toml:157` `rdev = { git = rustdesk-org/rdev, rev = a90dbe1 }` → **delete**
in every column (it is non-macOS-only). This removes a bus-factor unmaintained
fork dependency entirely.

### TypeScript

| Symbol / file | Verdict |
|---|---|
| `key-binding.ts` `resolveBinding` / `isTierZeroChord` / `keyBindingToAccelerator` | **Keep** — still the tier partition, but the `tap` arm becomes "refused / macOS-only" instead of "non-macOS + macOS" |
| `system-shortcuts.tauri.ts` push() tap partition (`:75-83`) | Split — chords still route to the plugin; the `taps` branch becomes empty (non-macOS) or macOS-only |
| `attach-global-shortcut-triggers.ts` (`startTriggerDispatch`) | Keep only if macOS Fn-input stays; otherwise **delete** |
| `attach-auto-paste-intent.svelte.ts` | **Keep** — it drives the surviving `auto_paste` TapIntent |
| `dictation-capability.svelte.ts` | **Keep**, but `needsAccessibility`/`isUnavailable` narrow to paste-at-cursor, not "global shortcut" |
| `create-tap-recorder.ts`, tap-capture branch of `KeyboardShortcutRecorder.svelte` (`:73-76,103-109`) | Delete if macOS Fn-input goes; keep (macOS-only) if it stays |

### User-visible copy that must change (from the UI audit)

- Reach badge "Works everywhere on this computer, needs Accessibility" and its
  lock icon (`KeyboardShortcutRecorder.svelte:50-55,158-170`) — **remove** for the
  input path; a Tier-0 chord never needs Accessibility.
- "Fn and holds need Accessibility" (`:239-250`) — becomes a hard refusal
  ("Fn and modifier-only holds aren't supported; use a chord"), not an upgrade
  prompt.
- "Add a modifier **or Fn**…" (`reserved-shortcuts.ts:119-121`) — drop "or Fn."
- "…fire your global shortcut and paste where you're typing"
  (`MacosAccessibilityGuideDialog.svelte:104-108`) — drop the "fire your global
  shortcut" clause; keep the paste clause (paste-at-cursor stays).
- "Your global shortcut isn't firing" stale-grant notice
  (`DictationCapabilityNotice.svelte:42-57`) — narrow to paste-at-cursor only.
- "Global shortcuts need an X11 session" (`:78-88`) — **delete** (the plugin needs
  no X11 tap).
- Home "record/listen from anywhere" dimming keyed off
  `dictationCapability.isUnavailable` (`+page.svelte:152-159`) — stop dimming
  Tier-0 chord labels.

## Paste-at-cursor split plan (open question 5, the crux)

**Can paste-at-cursor own the Accessibility / stale-grant state without a keyboard
tap? On macOS: no, not without regressing.** The architecture already half-splits
this, which makes the keep clean:

- Today the tap is held for any of three `TapIntent` reasons —
  `bindings || auto_paste || capturing` (`supervisor.rs:65-74`). `auto_paste` is
  **already independent** of gesture input.
- `write_text` gates on `capability() == Active` (`lib.rs:406-409`) precisely
  because a bare `AXIsProcessTrusted()` reports a **stale post-update grant as
  trusted**, so the synthetic ⌘V silently no-ops and the clipboard sandwich wipes
  the transcript — the exact silent-loss bug ADR-0040 fixed and the code comment
  at `lib.rs:399-405` refuses to reintroduce.
- The `Broken` signal **requires a running tap** (ADR-0011): you learn a grant is
  stale by watching the tap die under a still-trusted `AXIsProcessTrusted`. There
  is no cheaper reliable detector; observing the keystroke does not work on macOS.

**Therefore the split is: keep the tap, delete only its gesture-input reasons.**

1. Drop `TapIntent.bindings` and `TapIntent.capturing`; keep `auto_paste`. On
   macOS the tap runs iff auto-paste (cursor output) is enabled.
2. `TapController` keeps `capability()` and `set_auto_paste_enabled`; loses
   `set_bindings` / `set_capturing`.
3. `supervisor.rs` and the `DictationCapability` state machine survive unchanged —
   they are now purely the auto-paste grant oracle.
4. Rename the concept in comments/types from "dictation tap / global trigger" to
   something honest like "Accessibility grant watch" so a newcomer does not expect
   it to fire shortcuts.

**Non-macOS needs no split**: paste is already unconditional there
(`lib.rs:411-412`), so deleting the non-macOS tap costs paste nothing.

**The one refusal that would delete the whole macOS subsystem** (named, and
**not** recommended): refuse auto-paste-at-cursor entirely and ship
clipboard-only output. That collapses `mac_tap.rs`, `supervisor.rs`,
`DictationCapability`, and every Accessibility UI surface — the single largest
deletion prize in this memo. It is rejected because "speak and the text appears
where your cursor is" is Whispering's signature promise, and macOS grants go stale
on every update, so the `Broken`-aware paste is load-bearing, not gold-plating.
This is the asymmetric lever deliberately left unpulled.

## ADR

Recorded as **[ADR-0117](../../../docs/adr/0117-global-shortcut-input-is-plugin-chords-only-and-the-macos-tap-is-just-the-paste-grant-watcher.md)**
(Proposed): "Global shortcut input is plugin chords only, and the macOS tap is
just the paste grant watcher." It supersedes ADR-0008 and ADR-0019, and re-scopes
(retains) ADR-0011/0020/0040. When the wave below lands, flip the ADR to
`Accepted`, add the `Superseded by` pointer to ADR-0008 and ADR-0019, delete this
spec, and add a `docs/spec-history.md` row.

## Implementation wave

Ordered so the invariant (auto-paste stale-grant behavior) stays green at every
step, and the frontend stops calling a Rust command before that command is
deleted (stop-importing-before-deleting). Each wave is one reviewable,
self-contained, revertible commit or small stack. `#platform/*` seams and
generated specta bindings are regenerated in the wave that changes their command.

**Invariant held across all waves (Braden's item 4).** `write_text` keeps gating
on `TapController.capability() == Active` (`lib.rs:406-409`); the `auto_paste`
`TapIntent` reason, the supervisor, and the `DictationCapability` state machine
stay live; the `Broken` → `LeftOnClipboard` behavior is the acceptance gate. No
wave may route paste through a bare `AXIsProcessTrusted`.

### Wave 1 — Delete the non-macOS rdev backend (Braden's item 1)

Independent, macOS-untouched, conclusive from source.

- Delete `rdev_map.rs` and the `#[cfg(not(target_os = "macos"))]` `rdev::listen`
  block in `mod.rs:272-285`.
- Remove `rdev` from `Cargo.toml:157` (and the pin comment at `:108`).
- Gate the tap subsystem to `#[cfg(target_os = "macos")]`: off macOS there is no
  tap. `set_keyboard_shortcuts` / `set_keyboard_capturing` become no-ops on
  non-macOS (they are removed entirely in Wave 3); `get_dictation_capability`
  returns `Unsupported`/`Unknown` as today for non-macOS.
- Delete the Wayland "Global shortcuts need an X11 session" notice branch
  (`DictationCapabilityNotice.svelte:78-88`) — no tap means no X11 dependency for
  shortcuts.
- **Verify:** Windows/Linux build compiles; chord toggle/cancel fire; no rdev in
  the dependency tree (`cargo tree | rg rdev` empty).

### Wave 2 — Refuse Tier-1 input at the partition and in the UI (Braden's item 2)

Cross-platform, including macOS Fn. This stops every frontend caller from routing
a binding to the tap, before Wave 3 deletes the Rust surface.

- `key-binding.ts`: `resolveBinding` no longer returns `{ tier: 'tap' }`. A
  non-chord binding is refused, not routed. `keyCapability` drops the
  `needsAccessibility: true` global rung for holds (they are no longer bindable);
  a bare Fn or modifier-only gesture is simply not a valid global binding.
- Recorder: delete `create-tap-recorder.ts` and the `dictationCapability.isActive`
  swap in `KeyboardShortcutRecorder.svelte:73-76,103-109`; only the chord recorder
  runs. `eventModifiers` already cannot produce Fn, so the webview recorder
  naturally refuses it.
- `system-shortcuts.tauri.ts` push(): the `taps` branch is removed; only `chords`
  are pushed to the plugin. Stop calling `tauriOnly.keyboard.setBindings`.
- Delete `attach-global-shortcut-triggers.ts` and its runtime-owner registration
  (`runtime-owners.ts:24`) — no tap triggers to dispatch.
- Copy changes (from the UI audit): remove the "needs Accessibility" reach badge +
  lock (`KeyboardShortcutRecorder.svelte:50-55,158-170`); "Fn and holds need
  Accessibility" → honest refusal (`:239-250`); drop "or Fn"
  (`reserved-shortcuts.ts:119-121`); drop the "fire your global shortcut" clause
  from `MacosAccessibilityGuideDialog.svelte:104-108`; narrow "Your global
  shortcut isn't firing" to paste-only (`DictationCapabilityNotice.svelte:42-57`);
  stop dimming Tier-0 chord labels on `isUnavailable` (`+page.svelte:152-159`).
- Fix the stale `commands.ts:77` comment (claims a default Fn push-to-talk key).
- **Verify:** the recorder accepts only chords; Fn/modifier-only holds are refused
  with honest copy; toggle/cancel and chord hold-to-talk (push-to-talk bound to a
  chord) still fire; auto-paste still works and still shows its macOS notice.

### Wave 3 — Split `TapController` down to the paste grant watcher (Braden's item 3)

macOS Rust. The frontend no longer calls the input commands after Wave 2, so they
can be deleted.

- `supervisor.rs`: drop `TapIntent.bindings` and `TapIntent.capturing`; keep
  `auto_paste`. `wants_tap()` becomes `self.auto_paste`. The tap runs iff cursor
  output is enabled.
- `mod.rs` `TapController`: remove `set_bindings` and `set_capturing` and the
  `matcher`/`Control::Bindings`/`Control::Capturing` plumbing and synthetic-release
  `emit_trigger` path; keep `capability()` and the `auto_paste` control.
- `commands.rs`: delete `set_keyboard_shortcuts` and `set_keyboard_capturing`;
  keep `get_dictation_capability` and `set_auto_paste_enabled`. Update
  `make_specta_builder()` and regenerate bindings; delete `keyboard.setBindings`,
  `keyboard.setCapturing`, `startTriggerDispatch` from `tauri.tauri.ts`.
- Delete `matcher.rs` entirely. In `event.rs` delete `ShortcutTriggerEvent` and
  `ShortcutCaptureEvent` (and their `collect_events!` registration in `lib.rs`);
  keep `DictationCapabilityEvent`. In `mac_tap.rs` delete the gesture-decode /
  keycode-63 / capture path; keep the bare `CGEventTap` liveness, load-disable
  recovery, and leak-free restart that feed the supervisor.
- Keep `keys.rs`'s `KeyBinding`/`Key`/`Modifier` model (device-config still stores
  structured chord bindings validated by name in Rust).
- Rename the concept in comments/types from "dictation tap / global trigger" to
  "Accessibility grant watch" so a newcomer does not expect it to fire shortcuts.
- **Verify (item 4 gate):** auto-paste-at-cursor still pastes; with Accessibility
  revoked or stale, `write_text` returns `LeftOnClipboard` and the transcript is
  on the clipboard (no silent green "Delivered"); `DictationCapability`
  transitions still drive the paste notice.

### Wave 4 — Docs and decision hygiene

- Flip ADR-0117 to `Accepted`; add `Superseded by: ADR-0117` to ADR-0008 and
  ADR-0019 (the one permitted edit to an accepted ADR).
- Reconcile the ADR number to the true next-free integer at merge.
- Delete this spec; add its `docs/spec-history.md` row.
- Re-`rg` for stale `Tier-1` / `rdev` / `tap`-as-trigger names, imports, and copy.

## Sequencing and risk

- Wave 1 is orthogonal (non-macOS) and can land first or in parallel.
- Wave 2 must precede Wave 3 (frontend stops calling the commands before they are
  deleted). Waves 2 and 3 together are the macOS clean break.
- The single risk to watch is item 4: Wave 3 must not let the `auto_paste` intent,
  the supervisor, or the `capability()` gate regress. The `Broken`-stale-grant
  smoke is the gate on Wave 3, and largely reuses the existing ADR-0040 smoke.

## What is not done here

No files deleted or refactored yet; this spec is the plan. The untracked
cross-cutting spec (`specs/20260709T000000-background-runtime-residence-taxonomy.md`)
is left untouched. Execution begins on Braden's go for the wave above.
