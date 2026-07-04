# Transcription selector, reconciled for the post-GGUF world

**Date**: 2026-07-03
**Status**: Draft
**Owner**: Braden
**Supersedes**: `20260620T173000-transcription-model-selector-collapse.md` (deleted in the same pass that adds this; git keeps the body). That draft was written 2026-06-20, before the GGUF migration (#2324) collapsed three local engines into one Rust-owned catalog. Its spine survives; several of its conclusions do not. See "Changes from the prior draft."
**Builds on**: `20260702T120000-local-models-huggingface-transcribe-cpp.md` (the migration that made this reconciliation necessary), and by inheritance `20260527T003910-transcription-providers-from-first-principles.md`, `20260530T183000-transcription-provider-registry.md`.
**Scope**: design/decision only. No production code. Types below are sketches to pin the shape, not the implementation.

---

## Changes from the prior draft (read this first)

The 2026-06-20 draft ("collapse") got the **spine** right and it still holds:

- Split the picker's two unlike jobs: a per-use **switcher** and a rare **setup** surface. This split is now *more* load-bearing, not less.
- `isReady` is the only filter separating "show in the switcher" from "show in setup."
- Zero-choice, privacy-safe local default so a new desktop user makes no choice.
- No capability-filter chips, no per-model language array maintained for a tiny list.
- The footer sends you to add a model, not to "configure services."

What the migration **falsified or changed**, and this spec overturns:

1. **The row source is no longer "flatMap `PROVIDERS`."** On-device is now a *dynamic* catalog of N downloadable GGUF rows owned by Rust (`localModels` store), not a static engine-leaf in `PROVIDERS`. The switcher list is a **union of two sources**: the static non-onDevice provider registry (`star`, `byok`, `byoe`) and the live on-device store. Same leaf shape, honestly different provenance.
2. **BYOK contributes one switcher leaf per configured provider (its selected model), not one per model.** The draft's prose said "one row per `models[]` entry"; its own mock showed one remote model per provider. The mock was right. Showing all of a keyed provider's models in the switcher re-creates, at the model level, the exact "frequent buried under rare" smell the draft diagnosed at the provider level. Per-model choice (whisper-1 vs gpt-4o) is a setup act paid once.
3. **Star and BYOE each contribute one leaf when configured.** `star` is the connected Epicenter deployment's fixed transcription route; `byoe` is the custom server's configured model id. Neither expands to an in-switcher model catalog in Phase 1.
4. **On-device contributes one switcher leaf per *downloaded* GGUF.** Downloaded on-device models are independently switch-worthy (you A/B small vs large offline); "download" is the setup act, "downloaded" is the readiness. This is the crux answer (below).
5. **The catalog does NOT collapse to one row type.** Signing in to a star, adding a BYOK key, downloading a GGUF, and entering a BYOE endpoint are genuinely different affordances. One `<ModelRow>` renders the **switcher only**. The setup catalog is access-sectioned. The draft's "one row renders both surfaces" is refused as a false symmetry.
6. **Keep today's selection storage; refuse the draft's new composite active-pointer.** `transcription.service` (synced) + per-provider model keys (synced, also "last model" memory) + `transcription.local.selectedModel` (device-local, opaque id) already express the active model with honest sync boundaries. A new unified pointer buys nothing and costs a sync-schema migration plus a second source of truth to keep consistent.
7. **Cut the `languageFit` seam entirely, for now.** Post-migration it has zero real producer: the only signal that could back it (`supportsLanguage`) means "accepts a language hint," not "is multilingual" (the draft discovered this). A seam that always returns `ok`, or is backed by a known-wrong boolean, is worse than no seam. Re-earn it only when Rust `ModelInfo` carries a real `languageScope` (specified as a requirement below), and a curated english-only GGUF actually ships.
8. **`getSelectedModelNameOrUrl` dissolves.** Its cross-store `switch` (the #2336 subject and an open question here) is not centralized *or* inlined; it disappears. Each source computes its own leaf label at flatten time, where it already reads its own store. The trigger just shows the active leaf's label. This also folds in **#2337** for free (the BYOE leaf's label is its `modelId`).

---

## The crux, answered

> How does a dynamic, download-gated on-device catalog live in the same flat list as static `star` / `byok` / `byoe` providers? Is "one row per ready on-device model" right, or does on-device need its own affordance?

**Both, split along the switch/setup seam, because the seam is exactly where on-device dynamism does and does not matter.**

- **In the switcher: on-device needs no special affordance.** A *downloaded* GGUF is, at the leaf, identical to any other ready model: an icon, a name, a place it runs, a check if active. `one row per downloaded on-device model` is correct. The switcher renders on-device rows from `localModels.models.filter(downloaded)`, unioned with configured `star` / `byok` / `byoe` leaves. The download-gated part is invisible here, because undownloaded models are, by definition, not ready and not shown.

- **In the setup catalog: on-device needs its own affordance, and it already exists.** Downloading a multi-hundred-MB GGUF with progress, cancel, delete, and a recommended hero is categorically unlike signing in, pasting an API key, or entering a custom server URL. `LocalModelSelector.svelte` is that download manager and it is already built and correct. It is the on-device section of the catalog. It is not a `<ModelRow>` and must not be forced into one.

So the flat switcher survives the migration intact; the "one flat list renders both surfaces" claim does not. The switcher is one flat list. The catalog is a set of access-scoped setup panels. The migration did not break the flat list; it broke the idea that setup is also flat.

## Comparable apps (why BYOK shows one row, on-device shows many)

The one decision that needs outside evidence is the row-multiplicity asymmetry: **one leaf per keyed BYOK provider (its selected model), but one leaf per downloaded on-device GGUF.** These look inconsistent until you see what each category's "commit" act is.

| Product | On-device models | Remote models | Switch vs setup |
| --- | --- | --- | --- |
| **Ollama** | downloaded models are the run list; `ollama pull` is a separate download step | n/a (local-only) | hard split: run vs pull |
| **LM Studio** | "My Models" (downloaded) is the switch list; a separate Discover/Download tab is the catalog | n/a | hard split: My Models vs Discover |
| **OpenRouter** | n/a | one row per model, flat + searchable | no setup step: one account makes *every* model instantly ready, so "ready" and "listed" are the same set |
| **Cursor** | n/a | one row per model, but the user first **curates** which models appear via enable toggles | switch = the enabled set; setup = the enable toggles |
| **ChatGPT / Claude** | n/a | a short fixed menu (single vendor, all ready) | no setup |
| **Whispering (this design)** | one row per **downloaded** GGUF | one row per committed remote route (`star`, keyed BYOK provider's selected model, configured BYOE model id) | switch = committed models/routes; setup = the commit (sign in / download / add key + pick model / enter endpoint + model id) |

Two findings:

1. **Every local-catalog manager splits "downloaded = switchable" from "browse = download."** Ollama and LM Studio both do exactly what this spec proposes: your downloaded set is the switcher; discovering and pulling new models is a separate surface. This is direct precedent for one-row-per-downloaded-GGUF plus a separate catalog. It is the strongest evidence in the table because it is the same problem (a downloadable local catalog), not an analogy.

2. **Remote pickers show one row per model only because every model is instantly ready.** OpenRouter and ChatGPT have *no per-model or per-provider gate* - one account lights up the whole menu, so "listed" equals "ready" and a flat per-model list is honest. Whispering's BYOK models are gated behind a **per-provider API key** and drawn from an **uncurated vendor menu** (OpenAI's five, Deepgram's five, ...). If we listed every model of every keyed provider, the switcher would show a vendor's entire catalog, most of it never chosen - the OpenRouter shape without OpenRouter's "it's all ready anyway" justification. The honest analog is **Cursor**, which makes the user curate which remote models appear. We curate implicitly: the model you selected in setup is your commit; the provider's other models are uncommitted alternatives that live in the catalog, not the switcher.

The unifying principle both halves obey: **the switcher shows the models/routes you have committed to; committing is the setup act.** On-device commit = downloading a file (so every download shows). BYOK commit = adding a key and selecting a model (so the selected one shows). BYOE commit = configuring endpoint + modelId (so that one shows). Star commit = signing in to the connected Epicenter deployment (so the fixed star route shows). One rule, several unlike commit actions, several unlike row counts: honest asymmetry, not an inconsistency to file down.

(Note: under the greenfield "refuse the BYOK model menu" direction discussed separately, a BYOK provider has exactly one default model plus an optional override, so this asymmetry dissolves entirely - one-per-provider and one-per-model converge. It is a property of *keeping* the in-app BYOK menu, not a permanent fixture.)

---

## One sentence

The recorder popover is a single flat list of the transcription routes you can use **right now** (downloaded on-device GGUFs unioned with signed-in `star`, keyed `byok` providers, and configured `byoe` servers), one click to switch; setting a new one up happens on a separate, access-sectioned settings surface where on-device is a download manager, star is sign-in, BYOK is a key field plus model choice, and BYOE is an endpoint plus model id.

---

## Architecture

### Two surfaces, two shapes

```txt
                       Rust catalog (list_models)          PROVIDERS registry
                       localModels.models                  (star + byok + byoe)
                              |                                     |
             .filter(downloaded)                    .filter(isReady) → one leaf/provider
                              |                                     |
                              +------------------ union ------------+
                                              |
                                      readyModels(): Leaf[]
                                              |
                             ┌────────────────┴───────────────┐
                    SWITCHER (recorder popover)        (setup lives elsewhere)
                    flat <ModelRow> list, cmdk
                    select → set active
```

```txt
SETUP CATALOG  (transcription block of /settings/processing): NOT a flat list
┌ On your device ─────────────┐   LocalModelSelector (download manager: hero,
│  download / activate / delete│   empty-state, All-models collapsible). Already built.
├ Epicenter ──────────────────┤   sign in to use the connected star route
├ Provider API ───────────────┤   one card per BYOK provider: [Add key] + which-model select
├ Custom server ──────────────┤   Speaches: endpoint + modelId fields
└─────────────────────────────┘
```

### The switcher leaf

One shape, two producers. Each producer computes its own `label` where it already reads its own store, so no cross-store `switch` survives anywhere.

```ts
type SwitcherLeaf = {
  /** Stable list/cmdk key. star/byok/byoe: providerId. onDevice: model id. */
  key: string;
  providerId: TranscriptionServiceId;
  access: 'star' | 'byok' | 'byoe' | 'onDevice';
  icon: string;            // from PROVIDER_ICONS (local shares one ggml icon)
  label: string;           // star: provider model · byok: selected model · onDevice: model.name · byoe: modelId
  sublabel?: string;       // e.g. provider label, cost, BYOE endpoint host
  isActive: boolean;       // matches the current active selection (below)
  select: () => void;      // sets the active selection; see storage
};
```

```ts
// Sketch. Two sources, unioned. Reactive: star/byok/byoe read auth/settings/secrets,
// onDevice reads the localModels store; both re-run on change.
function readyModels(): SwitcherLeaf[] {
  const remote = TRANSCRIPTION_PROVIDERS
    .filter((p) => p.access !== 'onDevice')
    .filter((p) => isTranscriptionServiceConfigured(p))   // signed in / has key / endpoint+modelId
    .map((p) => toLeaf(p));                                // one leaf per committed provider route

  const onDevice = tauri
    ? localModels.models
        .filter((m) => m.downloaded)
        .map((m) => toLocalLeaf(m))                        // one leaf per downloaded GGUF
    : [];

  return [...onDevice, ...remote];                         // on-device first: privacy-forward
}
```

The switcher = `readyModels()` rendered as `<ModelRow>` in a `Command.List`, plus an "Add a model..." footer to the catalog, plus the zero-choice empty state. No `Command.Group` per access family is required (the icon and access glyph do the grouping the eye needs); a single flat list is the default, groups optional if the union grows.

### Readiness, precisely (on-device is not just "a non-empty key")

There are **two** readiness questions, and they must not share a definition:

1. **Membership** - which leaves appear in the switcher. Per source, per model:
   - star: signed in (`auth.state.status === 'signed-in'`).
   - byok: `secrets.get(apiKeyConfigKey).status === 'available'` (one leaf per keyed provider).
   - onDevice: `model.downloaded === true` (one leaf per downloaded GGUF; the store's own per-model verdict, never the deviceConfig key).
   - byoe: endpoint and modelId both non-empty.
2. **Active readiness** - is the model `transcription.service` currently points at actually runnable *right now*. This drives the recorder pipeline warning and `getTranscriptionReadiness`, and it is where today's `isTranscriptionServiceConfigured` is **wrong for local**.

Today `isTranscriptionServiceConfigured(onDevice)` is `hasValue(deviceConfig.get(modelConfigKey))` - true whenever *some* id is stored. But a stored id can point at a GGUF that was deleted from the shared HF cache, never finished downloading, or was selected on another device and never downloaded here (the id is synced-adjacent only in spirit; the file is device-local). A non-empty id is **not** a runnable model. Precise definition:

```ts
// Active readiness for the onDevice provider. `localModels` is the source of
// truth for presence; deviceConfig only holds the pointer.
function isLocalSelectionRunnable(): 'ready' | 'missing' | 'unset' | 'loading' {
  const id = deviceConfig.get('transcription.local.selectedModel');
  if (!hasValue(id)) return 'unset';            // nothing chosen → empty state
  if (!localModels.loaded) return 'loading';    // first Rust scan not back yet
  return localModels.find(id)?.downloaded ? 'ready' : 'missing';
}
```

- `unset` → zero-choice empty state (download the recommended GGUF).
- `missing` → the selected model is gone/not-downloaded here; show "download it again or pick another" (this is `LocalModelSelector`'s existing `isSelectionMissing` state; surface the same nudge on the recorder). This is the case a bare non-empty check silently passes and then fails at transcribe time.
- `loading` → treat as not-yet-blocking (optimistic): the scan lands in a tick and resolves to `ready`/`missing`; do not flash a warning during the first scan.

So `isTranscriptionServiceConfigured` splits by access: star keeps its signed-in check, byok keeps its key check, byoe keeps its endpoint + model id check, and **onDevice routes through `isLocalSelectionRunnable() === 'ready'`.** Membership (`model.downloaded`) and active readiness (`isLocalSelectionRunnable`) both read the `localModels` store, never the raw deviceConfig key, so "there is a stored id" can never masquerade as "there is a runnable model."

### Selecting a leaf writes today's keys

No new storage. `select()` per source:

- **star**: `settings.set('transcription.service', 'epicenter')`. The provider's fixed model lives in `PROVIDERS.epicenter.model`; no model key is written.
- **byok**: `settings.set('transcription.service', providerId)`. The provider's model key already holds its selected model (the leaf's label); nothing else changes.
- **onDevice**: `settings.set('transcription.service', 'local')` and `deviceConfig.set('transcription.local.selectedModel', model.id)`.
- **byoe**: `settings.set('transcription.service', providerId)`.

`isActive` derives the same way it is read: onDevice leaf is active when `model.id === deviceConfig.get('transcription.local.selectedModel')` **and** `service === 'local'`; a star/byok/byoe leaf is active when `providerId === settings.get('transcription.service')`.

### The active selection: keep the current shape, refuse a new pointer

The active model is already fully expressed by three existing values:

| Value | Store | Sync? | Role |
| --- | --- | --- | --- |
| `transcription.service` | settings (KV) | synced | which provider is active |
| `transcription.<provider>.model` | settings (KV) | synced | that BYOK provider's model, and "last model" memory |
| `transcription.local.selectedModel` | deviceConfig | device-local | the opaque local GGUF id (`{repo}@{rev}/{file}`) |
| `PROVIDERS.epicenter.model` | registry | static | the star route's fixed wire model |

This is the right shape. Which provider you prefer can sync across devices; which on-device file you happened to download cannot (another device may not have it). Flipping BYOK providers and back restores your last model for free. A device that syncs `service = 'local'` but has nothing downloaded lands on `isReady = false` and gets the empty state. No migration, no redundant pointer to keep consistent.

**Refused**: the prior draft's single composite active-pointer. It would duplicate what these three already say, force a sync-schema change, and create a second source of truth that must be reconciled with the per-provider keys the switcher still writes. The refusal deletes that whole consistency burden.

---

## The `getSelectedModelNameOrUrl` question, dissolved

The open question ("centralize the three-store switch, or extract it?") assumes the switch must exist. It does not.

Today `getSelectedModelNameOrUrl(service)` switches on provider family to read different stores for the trigger subtitle. In this design the **leaf already carries its `label`**, computed by the producer that owns that store:

- star producer reads `PROVIDERS.epicenter.model` → leaf label.
- byok producer reads `settings.get(modelSettingKey)` → leaf label.
- onDevice producer reads `model.name` from the `localModels` store (the id→name join #2336 added) → leaf label.
- byoe producer reads `deviceConfig.get(modelIdConfigKey)` → leaf label.

The trigger shows the **active leaf's** label: `readyModels().find((l) => l.isActive)?.label`. There is no `switch` left to place in a component or a helper; each branch lives next to the store it reads, at flatten time. Braden's #2336 instinct (co-locate the branches that read three different globals) is honored by the flattening itself, which is where those three globals are already being read once each.

**#2337 folds in here.** The BYOE leaf's label is decided in one place: `modelId` as the primary label, the endpoint host as the sublabel. Surfacing the model id is a one-line decision in `toLeaf`, not a separate fix, and it lands in Phase 1 with the rest of the leaf construction.

---

## Zero-choice first run

`readyModels()` is empty → show a default card, not a blank list. The card differs by platform because onDevice availability does:

- **Desktop, nothing ready**: hero = "Transcribe on this device: private, offline, free" with a one-click **Download {recommended GGUF}** action. This already exists as `LocalModelSelector`'s empty state; the switcher's empty state can reuse it or link straight to it. `recommended` = `localModels.models.find((m) => m.recommended)`.
- **Web, nothing ready**: on-device cannot run, so the honest default is not a silent remote pick. Point to the catalog's Epicenter / Provider API sections ("Sign in to Epicenter or add an API key to transcribe"). Remote transcription is always explicit opt-in; nothing auto-uploads audio.

The default is never a remote provider chosen for you. That invariant is inherited from the prior draft and unchanged.

---

## The setup catalog

Access-sectioned, replacing the current "pick a provider from a dropdown, then configure it" flow:

- **On your device**: `LocalModelSelector` (download manager). Unchanged by this spec; it is already the correct local affordance.
- **Epicenter**: sign-in state for the connected star route. The account popover owns credits; this catalog section only makes the route understandable.
- **Provider API**: one card per BYOK provider: brand icon, `[Add key]` (or "key set"), and the which-model select (`ProviderConfigFields` + the model `Select` already in `TranscriptionRuntimeConfig`). This is where whisper-1 vs gpt-4o is chosen, once.
- **Custom server**: the Speaches endpoint + modelId fields already in `TranscriptionRuntimeConfig`.

`TranscriptionServiceSelect.svelte` (the access-grouped provider dropdown) is **deleted**: with the catalog laid out as scrollable access sections, there is no provider to pick before configuring; you scroll to the one you want. This realizes the prior draft's deletion goal, but via a sectioned setup surface rather than a shared flat list.

> Smaller-diff fallback if the catalog rebuild is deferred: keep `TranscriptionServiceSelect` as-is and ship only the switcher rebuild first. The switcher is the daily win and is independently shippable; the catalog reshape can follow. Flagged so the execution handoff can stage it.

The advanced fields (spoken-language hint, system prompt, unload policy) stay where they are, gated by the honest `supportsPrompt` / `supportsLanguage` per-model capability (for onDevice, from `ModelInfo`; for star/byok/byoe, provider-wide). Note `supportsLanguage` keeps its *honest* job here (gate the "send a language hint" field); it is only its misuse as an "english-only" switcher signal that is refused.

---

## Refusals and what each deletes (asymmetric wins)

| Refuse | Give up | Delete |
| --- | --- | --- |
| A unified composite active-pointer | one tidy "the selection is one value" story | a sync-schema migration + a second source of truth to reconcile with the per-provider keys |
| Per-BYOK-model switcher rows | one-click access to a provider's non-selected models | switcher ballooning (a 5-key user would see ~13 rows); keeps the 2-4 item premise the whole design rests on |
| The `languageFit` seam (for now) | an "English only" marker | a seam that today always returns `ok`, or is backed by the known-wrong `supportsLanguage` |
| "One row renders both surfaces" | architectural symmetry | the fiction that a download manager and an API-key field are the same widget |
| Capability filter chips (inherited) | filter-by-multilingual/free/on-device | a per-model language array maintained forever for a tiny list |
| Migrating old local selections (settled in the migration spec) | remembered pre-GGUF local model | any migration reader; the value was device-local with no contract |

---

## Requirements handed to Rust (specify, do not implement)

1. **`ModelInfo.recommended` marks exactly one model.** The zero-choice hero and `LocalModelSelector` both assume a single recommended model (they already fall back to `models[0]`). Keep it single. (Already present.)
2. **If english-only marking is ever wanted**, add a real language-scope signal to `ModelInfo`, e.g. `languageScope: 'multilingual' | 'english-only'` (or `englishOnly: boolean`), probed from the GGUF header `general.languages`. Handy's upstream `ModelDescriptor` already carries `supported_languages` / `supports_language_detection`; Whispering's `ModelInfo` binding dropped that richness. The data exists in the GGUF; surfacing it is cheap and additive. Until it exists, ship **no** language marker in the switcher. Do not repurpose `supportsLanguage` for this.

No other Rust change is required for this spec. The catalog, download lifecycle, and id→name join already exist.

---

## What would falsify this direction

The whole design rests on the switcher staying a short list (the prior draft's "2-4 items, not worth filtering"). It breaks if:

- **A real user routinely keeps 6+ ready models/routes and switches among them.** Ready = downloaded onDevice + signed-in star + keyed BYOK + configured BYOE. If users download 6+ GGUFs, key 6+ BYOK providers, or configure several remote routes, the flat switcher becomes scroll-and-search and would want grouping / favorites / a "recent" cluster. My belief that this is rare is a **guess** (see assumptions).
- **Users toggle *within* a BYOK provider frequently** (whisper-1 vs gpt-4o daily). If so, "BYOK contributes one leaf" is wrong and BYOK would need per-model switcher rows after all, and the count balloons. I judge this rare; also a guess.

Either falsifier is an "onDevice (or BYOK) grows its own switcher affordance" change, not a redesign of the seam. The switch/setup split holds regardless.

---

## Assumptions worth verifying before anyone builds this

These are the places I am guessing at real-world counts or Rust behavior, not stating fact:

1. **Downloaded-onDevice-model count is typically 1-3.** This is the load-bearing guess behind "onDevice as flat switcher rows." No telemetry consulted. If it is routinely 6+, revisit the switcher's onDevice affordance (the falsifier above). *Verify against any usage signal, or Braden's product intent for how many GGUFs a user keeps.*
2. **Within-provider BYOK model switching is rare.** Behind "BYOK contributes one leaf." *Verify against product intent.*
3. **The curated Rust catalog stays small (~5-15).** The migration spec says hand-curate a handful, revisit at >15; Handy ships 76. If Whispering's catalog grows toward Handy's size, `LocalModelSelector`'s flat "All models" collapsible needs search/filter, and the catalog's local section becomes a real browse surface. *Verify the intended catalog size.*
4. **A curated english-only GGUF may never ship.** The migration explicitly allows dropping Moonshine if no `handy-computer` GGUF equivalent is curated. If nothing english-only ships, `languageFit` never comes back and requirement #2 stays dormant. *Verify whether an english-only local model is in the catalog plan.*
5. **`localModels.models` is the right onDevice readiness source on desktop, and empty on web.** The store is Tauri-only (`refresh()` early-returns without `tauri`). Confirmed in code, but the union's web behavior (onDevice leaves = `[]`) depends on it; called out so the execution pass keeps the `tauri` guard.

---

## Implementation phases (for a later execution handoff, not this pass)

Design-level only. Ordering favors shipping the daily win first and keeping each step independently green.

### Phase 1 - the switcher (the daily win, independently shippable)
- Build `readyModels(): SwitcherLeaf[]` as the two-source union (star/byok/byoe from `TRANSCRIPTION_PROVIDERS`, onDevice from `localModels.models.filter(downloaded)`), each producer computing its own `label`.
- Build `<ModelRow>` (icon + label + access glyph + active check).
- Rebuild `TranscriptionSelector`'s popover as the flat `readyModels()` list + "Add a model..." footer + zero-choice empty state. Delete the BYOK accordion (`toggleServiceExpanded`, chevron, `expandedServices`) and `getSelectedModelNameOrUrl` (label now lives on the leaf).
- Route the onDevice branch of `isTranscriptionServiceConfigured` (and the recorder warning) through `isLocalSelectionRunnable` so a `missing` selection stops passing as ready.
- The BYOE leaf label is `modelId` (primary) + endpoint host (sublabel): #2337 lands here, because the label is built in the leaf, not the setup page.
- Keep the `standalone` / `pipeline` variant only if the trigger still needs two looks; drop it if the flat list makes them identical (evaluate during build, per the prior draft).
- Leave `TranscriptionServiceSelect.svelte` and the setup page untouched; Phase 1 ships without them.

### Phase 2 - the setup catalog
- Reshape the transcription block of `/settings/processing` into access sections: `LocalModelSelector` (as-is) + Epicenter sign-in section + per-BYOK-provider key/model cards + Speaches endpoint card.
- Delete `TranscriptionServiceSelect.svelte`.

### Phase 3 - prove
- Typecheck + web build + desktop build (onDevice rows only exist on Tauri).
- Smoke: desktop first-run empty state → download recommended → it appears in the switcher; switch between two downloaded onDevice models; sign in to Epicenter → star appears as one leaf; add a BYOK key → that provider's selected model appears as one leaf; web shows no onDevice leaves and the remote-setup empty state.

### Not in scope
- The `languageFit` / english-only marker (dormant until Rust requirement #2 lands).
- A new active-selection pointer (refused).
- The provider-key-enumeration SSOT (per-provider model keys in `definition.ts`); untouched. *Bonus note*: it does **not** dissolve here. It would only collapse if the per-provider model keys became a single `transcription.models` map keyed by providerId, which is a separate refactor with its own risk; this spec deliberately does not force it.

---

## Success criteria

Split so Phase 1 (the switcher, the daily win) ships and merges on its own. Phase 1 must **not** depend on deleting `TranscriptionServiceSelect.svelte` or reshaping the setup page; it rebuilds only the popover and leaves the existing setup surface untouched behind it.

### Phase 1 - the switcher (independently shippable)

- [ ] The recorder popover is a single flat list of ready models/routes: one leaf per **downloaded** onDevice GGUF, unioned with the signed-in `star` provider, one leaf per **keyed** BYOK provider (its selected model), and each **configured** BYOE server. No accordion, no drill-in, no scrolling past unconfigured providers.
- [ ] Membership uses the precise readiness: onDevice from `model.downloaded` (the store), never the raw deviceConfig key.
- [ ] Active readiness for onDevice routes through `isLocalSelectionRunnable`: a stored id pointing at a missing/not-downloaded GGUF reads as `missing` (nudge to re-download or pick another), not as ready. A bare non-empty id never passes as runnable.
- [ ] Selecting a row writes only today's keys (`transcription.service` + the provider's model key, or `transcription.local.selectedModel`); no new pointer exists.
- [ ] The trigger label reads from the active leaf; `getSelectedModelNameOrUrl`'s three-store switch is gone.
- [ ] BYOE leaves show the model id as the primary label, endpoint host as the sublabel (#2337 resolved).
- [ ] Desktop first run shows the download-recommended-GGUF hero; web shows an Epicenter / Provider API setup prompt; neither auto-selects a remote provider.
- [ ] The `standalone`/`pipeline` trigger variants survive only if they still render differently; otherwise the fork is dropped.
- [ ] `TranscriptionServiceSelect.svelte` still exists and the setup page still works (untouched by Phase 1).
- [ ] Typecheck + web build + desktop build pass; switcher smoke cases verified.

### Phase 2 - the setup catalog (follows; not required for Phase 1 to ship)

- [ ] The setup catalog is access-sectioned (on-device download manager / Epicenter sign-in / Provider API key cards / Custom server endpoint card).
- [ ] `TranscriptionServiceSelect.svelte` is deleted; nothing imports it.
- [ ] No `languageFit` seam and no per-model language array ship; `supportsLanguage` keeps only its honest job (gating the language-hint field).
- [ ] Typecheck + web build + desktop build pass; setup smoke cases verified.

---

## References

- `apps/whispering/src/lib/components/settings/selectors/TranscriptionSelector.svelte` - the popover to rebuild (BYOK accordion, `getSelectedModelNameOrUrl`, `standalone`/`pipeline` variant).
- `apps/whispering/src/lib/components/settings/LocalModelSelector.svelte` - the onDevice download manager; the correct onDevice catalog affordance, already built.
- `apps/whispering/src/lib/components/settings/TranscriptionServiceSelect.svelte` - the provider dropdown to delete.
- `apps/whispering/src/lib/components/settings/TranscriptionRuntimeConfig.svelte` - the setup surface to reshape; source of the BYOK model select, Speaches fields, and the honest per-model capability read.
- `apps/whispering/src/lib/state/local-models.svelte.ts` - the Rust catalog projection; `models` (with `downloaded`), `stateOf`, `find`, `download`/`cancel`/`remove`. The switcher's local source.
- `apps/whispering/src/lib/services/transcription/providers.ts` - `PROVIDERS`; the static star/byok/byoe source. Note the four honest access shapes (`star` fixed model + session, `byok` static `models[]` + key, `onDevice` `modelConfigKey` only, `byoe` `endpointConfigKey` + `modelIdConfigKey`).
- `apps/whispering/src/lib/services/transcription/provider-ui.ts` - `TRANSCRIPTION_PROVIDERS` join + icons.
- `apps/whispering/src/lib/settings/transcription-validation.ts` - `isTranscriptionServiceConfigured` (the readiness predicate; its onDevice branch must move off the raw deviceConfig key onto `isLocalSelectionRunnable`, i.e. the `localModels` store's `downloaded` verdict).
- `apps/whispering/src/lib/components/settings/LocalModelSelector.svelte:56` - the existing `isSelectionMissing` derivation the recorder's local readiness should mirror.
- `apps/whispering/src/lib/workspace/definition.ts:184` - `transcription.service` + per-provider model keys (the selection storage kept as-is).
- `apps/whispering/src/lib/tauri/bindings.gen.ts:555` - `ModelInfo` (where a `languageScope` field would be added; where `recommended` lives).
- Issue #2337 - BYOE model id never surfaced; resolved in Phase 1 (the leaf's `modelId` primary label + endpoint sublabel).
- `20260702T120000-local-models-huggingface-transcribe-cpp.md` - the migration this reconciles against.
