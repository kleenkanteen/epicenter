# Local models: one Rust-owned Hugging Face + transcribe.cpp GGUF runtime

**Date**: 2026-07-02
**Status**: Draft
**Owner**: Braden
**Branch**: handy-huggingface (Draft spec plus private Rust spike)
**Builds on**: `local-model-disk-identity.md`, `model-lifecycle-lazy-collapse.md`, `20260620T173000-transcription-model-selector-collapse.md`
**Stance**: greenfield clean break. Local-model compatibility is refused, not preserved (see "Compatibility paths refused").

## Product sentence

> Rust owns the local model catalog, download, and capability truth; the webview enters through one command surface; transcribe.cpp runs GGUF batch as the one local runtime; a model is identified by its Hugging Face coordinate (`repoId` + `revision` + `filename`).

Everything below is judged against that sentence. Any branch, owner, field, or path the sentence survives without is refused.

## One sentence

Replace Whispering's three TS-cataloged transcribe-rs engines with a single Rust-owned Hugging Face catalog whose models run through transcribe.cpp GGUF batch, identified by HF coordinate; existing local selections and downloaded ONNX/GGML models are broken deliberately (re-download + re-select), and realtime streaming is out of scope.

## How to read this spec

```txt
Read first:   Product sentence, Target shape, Phases, Smallest first diff
Read for model: Model identity, Ownership, the transcribe-rs sunset
Read the loss: Compatibility paths refused (the explicit break list)
Read if curious: What was inspected, What Handy did, Rejected alternatives, Blockers before realtime
```

## What was inspected

**Whispering (this repo), current state**

- `apps/whispering/src/lib/constants/local-models.ts` — TS-owned download catalog. Three engine shapes: `whispercpp` (single `.bin`), `parakeet` (directory of ONNX), `moonshine` (directory of ONNX). Whisper pulls GGML from `ggerganov/whisper.cpp` on HF via direct `resolve/main` URLs; Moonshine pulls ONNX from `UsefulSensors/moonshine` on HF; Parakeet pulls ONNX from Epicenter GitHub Releases.
- `apps/whispering/src/lib/services/transcription/providers.ts` — provider SSOT. Three local providers (`whispercpp`, `parakeet`, `moonshine`), each with a `modelConfigKey` (a `deviceConfig` key) and `modelKind`. Capabilities are a static `{ supportsPrompt, supportsLanguage }` per provider. **The local-model selection lives in `deviceConfig`, documented "device-local, never synced" — there is no sync wire format, durable storage contract, or migration reader guarding it.**
- `apps/whispering/src/lib/operations/transcribe.ts` — local dispatch + prewarm. Model identity is the **folder entry name** read from `deviceConfig`, passed to `commands.transcribeRecording` / `commands.prewarmModel`. Cloud upload paths are untouched by this work.
- `apps/whispering/src-tauri/src/transcription/config.rs` — `Engine { Whispercpp, Parakeet, Moonshine }`; `TranscriptionSpec { engine, model_name, language, initial_prompt }`, `model_name` a single folder entry.
- `apps/whispering/src-tauri/src/transcription/model_cache.rs` — resident-engine cache over `transcribe-rs`; resolves `{app_data}/models/{engine}/{entry}`; byte-fingerprint reuse (`local-model-disk-identity.md`), unload policy + idle watcher.
- `apps/whispering/src-tauri/src/transcription/model_folder.rs` + `src-tauri/src/download.rs` — Rust owns filesystem truth (enumerate, stat-through-symlink, delete, staged `.partial` download → 90% size-floor integrity check → promote rename). `download_model(engine, entry_name, files, …)` streams catalog URLs directly; the webview passes catalog data per call and Rust stores none of it.
- `apps/whispering/src-tauri/Cargo.toml` — `transcribe-rs = "=0.3.8"` with per-target features (`whisper-cpp`, `whisper-metal`, `onnx`, `ort-coreml` on macOS; `whisper-vulkan`/`ort-directml` on Windows).

**Handy (`/tmp/handy-upstream`, the target direction)**

- `src-tauri/Cargo.toml` — two runtimes: `transcribe-rs = "0.3.8"` ONNX-only (Parakeet, Moonshine, SenseVoice, GigaAM, Canary, Cohere) and `transcribe-cpp = "0.1.0"` for the whole GGUF/ggml family (Whisper, Parakeet, Voxtral, Qwen3-ASR, Nemotron, …) with **per-target backend features** (`metal` macOS; `vulkan`/`cuda` Linux; DirectML/AVX shims Windows x86_64; portable ARM Windows aarch64). Downloads via a `cjpais/hf-hub` fork into the shared HF cache.
- `src-tauri/src/managers/model.rs` — **Rust-owned** registry. `ModelSource { Url{url,sha256} | HuggingFace{repo_id,revision} | Local }`. `ModelInfo`/`ModelDescriptor` carry per-model capabilities (`supports_streaming`, `supports_translation`, `supports_language_detection`, `supported_languages`, scores, recommended rank). HF models resolve/download through hf-hub's shared cache; custom `.bin`/`.gguf` and cache-resident GGUF are auto-discovered.
- `src-tauri/src/catalog/{mod.rs,catalog.json}` — `catalog.json` (76 models) generated at build from the `handy-computer` HF org, compiled in. HF id folds the default quant filename into the model id (`{repo_id}/{filename}`), so a catalog entry dedups against the same file later found in the cache.
- `src-tauri/src/managers/model_capabilities.rs` — GGUF header probe (`general.architecture`, `general.languages`, `stt.capability.*`) read pre-download, reconciled against the loaded model post-load (`set_runtime_capabilities`). `KNOWN_ARCHES` lists transcribe-cpp's arches.
- External grounding: `handy-computer/transcribe.cpp` hosts GGUF under the `handy-computer` HF org, batch + streaming across families. Confirmed via Handy's `Cargo.toml` and `catalog.json` (`handy-computer/*-gguf` repos).

## The load-bearing finding

Handy's move is a **second runtime**, not catalog plumbing. `transcribe-cpp` (GGUF) was added and Whisper migrated onto it; the HF catalog, GGUF capability probe, and hf-hub cache all exist to serve that runtime. So a GGUF file cannot load in transcribe-rs's ONNX/whisper-cpp loaders, and Whispering's existing local models cannot be "repointed" at `handy-computer` HF — they are the wrong file format for the wrong runtime. Adopting the Handy direction means adopting transcribe.cpp GGUF as the local runtime. On the greenfield stance, that is exactly what we do, and we do not carry the old runtime forward as a product path.

## Target shape

### Ownership (one owner per value)

| Value | Owner (target) | Was |
| --- | --- | --- |
| Local model catalog (which models exist, coordinates, sizes, capabilities) | **Rust** (`transcription::catalog`, seeded from `handy-computer` HF) | TS `local-models.ts` |
| Model identity | **HF coordinate** `{repoId, revision, filename}` (rendered as a stable `modelId` string) | engine-specific folder entry name |
| Download + on-disk truth | **Rust** (hf-hub shared cache, or app-data GGUF folder — see open question) | Rust `download_model`, app-data folders |
| Per-model capabilities (languages, translate, lang-detect; streaming later) | **Rust** GGUF probe + post-load reconcile | static per-provider TS flags |
| Selected local model | **one** `deviceConfig` key holding the `modelId` string | three per-engine keys |
| Local runtime | **transcribe.cpp** GGUF batch | transcribe-rs (whisper-cpp/ONNX) |

The TS `local-models.ts` catalog is **removed from the target shape.** Dual catalog ownership existed only to avoid migration; greenfield refuses the migration, so it refuses the second owner. The webview receives the catalog and per-model capabilities from Rust (`list_models`-style command returning `ModelInfo`), and stores only the selected `modelId`.

### Model identity

One canonical identity, a Hugging Face coordinate:

```rust
struct ModelCoord { repo_id: String, revision: String, filename: String }
// rendered to a stable, storable id the webview persists as the selection:
//   modelId = "{repo_id}@{revision}/{filename}"   (or Handy's "{repo_id}/{filename}" if revision is pinned to "main")
```

- **No** `url` / `local` legacy discriminant in the core target. HF coordinate is the single source. (`Local`/custom drop-in GGUF is a *real* product operation — "add your own model" — but it is earned separately, not core to this pass; see Open questions. It is not a compatibility path.)
- The `modelId` string is what `deviceConfig` stores and what `transcribe_recording` receives. Rust resolves it to a cache/disk path at point of use, exactly as `model_path_for` does today but keyed on coordinate instead of folder entry.

### One local provider

`providers.ts` collapses its three local providers into **one** `local` provider (transcribe.cpp). The user picks a *model*, never an *engine* — which is exactly the flat-model-list target of `20260620T173000-transcription-model-selector-collapse.md`. Cloud/self-hosted providers are unchanged. Per-model capability (languages, prompt support) is read from Rust `ModelInfo`, not the static per-provider `capabilities` flags; the static flags remain only for cloud providers (honest asymmetry: cloud capability is provider-wide, local capability is per-GGUF).

### One runtime collapses the engine discriminant

With a single local runtime, the `engine` discriminant is single-valued and dissolves:

- `Engine { Whispercpp, Parakeet, Moonshine }` → **deleted** (one runtime, nothing to switch on).
- `TranscriptionSpec { engine, model_name, … }` → `TranscriptionSpec { model_id, language, initial_prompt }`. `transcribe_recording` / `prewarm_model` keep their names (hot-path callers in the recording pipeline stay) but take `model_id`, not `(engine, model_name)`.
- `model_cache.rs`'s per-engine `ensure_engine_loaded` / `with_whisper|parakeet|moonshine` arms → **collapse to one** GGUF load/transcribe arm. The resident-cache, disk-identity reuse, unload policy, idle watcher, and `ModelStateEvent` lifecycle are **runtime-agnostic and kept**, re-pointed at the GGUF engine.

### Deletion inventory (grounded in a coupling audit)

I traced every local-model command, its TS consumers, and what the recording/cloud/audio paths share. Result: the transcribe-rs system has **no coupling to audio, cloud, or the recording pipeline** beyond two hot commands and the runtime-agnostic lifecycle, both of which are *kept and re-pointed*. So it is deleted in the same pass, not sunset — there is no unrelated rewrite forcing us to keep it.

**Delete now (local-model-only, no unrelated coupling):**

- `src-tauri/src/transcription/model_import.rs` (`link_local_model`) — BYO ONNX symlink import (refusal #6).
- `src-tauri/src/transcription/model_folder.rs` (`list_model_entries`, `delete_model_entry`, `resolve_model_files`, `download_model`, `reveal_models_folder`) — the folder-entry model system, replaced by the HF-coordinate catalog + a `list_models` command.
- `src-tauri/src/download.rs` (`DownloadManager`, `cancel_download`, `stream_to_file`) — audited: used **only** by `model_folder`'s staged download (lib.rs manages its state and registers `cancel_download`; no other consumer). Delete if GGUF downloads via hf-hub; if GGUF reuses direct streaming, keep only `stream_to_file` and drop the directory-staging + `.partial` promote machinery.
- `model_cache.rs` transcribe-rs load/transcribe arms + `parse_moonshine_variant` + `config.rs` `Engine` enum — replaced by the one GGUF arm.
- `src/lib/constants/local-models.ts` — the TS catalog.
- The three local providers in `providers.ts` and the three `transcription.{whispercpp,parakeet,moonshine}.model` `deviceConfig` keys → collapse to one `local` provider + one `transcription.local.selectedModel` key.

**Rewrite in this pass (local-model UI — "related", so rewritten, never preserved):**

- `src/lib/components/settings/{LocalModelSelector,LocalModelDownloadCard,TranscriptionRuntimeConfig}.svelte`, `components/settings/selectors/TranscriptionSelector.svelte`
- `src/lib/state/model-folder.svelte.ts`, `src/lib/services/transcription/local-model-folder.ts`, `src/lib/settings/transcription-validation.ts`
- These render the picker/download flow off the deleted folder-entry system; they are rebuilt against `list_models` + `modelId`. Rebuilding them is the provider-collapse itself, not collateral.

**Keep and re-point (runtime-agnostic; removal WOULD force unrelated rewrites):**

- `transcribe_recording`, `prewarm_model` commands — the hot transcription path the recording pipeline depends on. Kept, re-typed to `model_id`.
- `get_transcription_state`, `set_unload_policy`, `ModelStateEvent`, the resident cache + idle watcher — model lifecycle mechanism, independent of which runtime loads the bytes.
- `src/lib/operations/transcribe.ts` cloud/self-hosted dispatch (`UPLOAD_DISPATCH`), all recording/audio/blob code — untouched.
- `src/lib/tauri/{commands.ts,bindings.gen.ts}` — **regenerated**, not hand-edited, per the command-sync rule in `apps/whispering/AGENTS.md`.

No migration reader, no "already downloaded" detection for legacy files, no dual-runtime dispatch, no compatibility alias is written anywhere.

## Phases

Because the lifecycle scaffold (resident cache, unload policy, model-state events, the two hot commands) is kept and re-pointed, adding the GGUF runtime and deleting the transcribe-rs runtime happen in **one pass** — there is no dual-runtime interim to maintain, so no separate deletion phase.

### Phase 1 — Swap the local runtime to Rust-owned HF/GGUF batch (add + delete together)

1. Add `transcribe-cpp = "0.1.0"` to `apps/whispering/src-tauri/Cargo.toml` with per-target backend features mirroring Handy's target tables. **This platform/CI matrix is the real cost of the whole effort** — start the spike here.
2. Add a Rust catalog (`transcription::catalog`) of `handy-computer` GGUF models keyed by HF coordinate. Hand-curated (a handful of entries); a build-time generator from the HF org is deferred (see Open questions).
3. Add `ModelInfo` (id, name, coordinate, size, per-model capabilities) + a `list_models` command; add the GGUF download path (hf-hub shared cache, or the derived `resolve/{revision}/{filename}` URL) and the one GGUF load/transcribe arm, reusing the kept resident-cache + unload lifecycle.
4. Re-type `transcribe_recording` / `prewarm_model` to `model_id`; delete the `Engine` enum, the per-engine `model_cache.rs` arms, `parse_moonshine_variant`, `model_import.rs`, `model_folder.rs`, the now-dead parts of `download.rs`, and `local-models.ts`. Regenerate the command bindings.
5. Collapse `providers.ts` to one `local` provider + one `transcription.local.selectedModel` key; rebuild the picker/download UI against `list_models` + `modelId`.
6. GGUF **batch only**. Capabilities probed from the GGUF header pre-download, reconciled post-load.

Everything in the Deletion inventory lands in this pass; nothing is left as sunset code.

### Phase 2 — Realtime streaming (out of scope now)

Separate lifecycle + recorder-integration problem. Design only after batch GGUF is proven. See "Blockers before realtime".

## Smallest first diff

The genuine gating risk is transcribe-cpp's **cross-platform Cargo feature matrix**, not TypeScript. So the smallest *valuable* first diff is a **Rust spike**: add `transcribe-cpp` to `Cargo.toml` behind the current target tables, load exactly one `handy-computer` GGUF (a Whisper GGUF is closest to current behaviour), and prove `cargo check` + a single batch transcription end-to-end on the dev platform. Everything else (catalog surface, provider collapse, picker) is cheap once the runtime compiles and loads on every target.

Do **not** start with a TS catalog reshape: the TS catalog is being deleted, so reshaping it is throwaway work.

## Spike checkpoint

The branch now carries a private Rust-only spike that proves the macOS/Metal API path:

- Runtime dependency: `transcribe-cpp = "0.1.0"` with Handy-modeled target features.
- Download/cache dependency: crates.io `hf-hub = "0.5"` using the shared Hugging Face cache (`Cache::from_env()` / `ApiBuilder::from_env()`).
- Anchor model: `handy-computer/whisper-small-gguf@main/whisper-small-Q4_K_M.gguf`.
- Shape: private branch scaffolding, not product API. The temporary spike command is not registered in the Tauri command builder and is not emitted into `bindings.gen.ts`.

These are spike decisions, not final product commitments. The next product implementation can either keep the shared HF cache or move GGUF files under app data, but it should make that choice explicitly before replacing the picker/download flow.

## Platform proof and the dynamic-backend bundling requirement

Phase 1 step 1 called the cross-platform Cargo/CI matrix "the real cost of the whole effort." A spike pass proved the macOS API path, and a **runner-proof preview CI pass** (PR #2304, run 28647916407) then exercised the non-mac bundles for the first time. It surfaced two real problems the local host could not see. The findings and the committed packaging wiring are below.

### Build status per target

| Target | transcribe-cpp posture | Link | Files beside `libtranscribe` | Build proof (CI run 28647916407) |
| --- | --- | --- | --- | --- |
| macOS aarch64 | `metal` | **static** (`GGML_METAL_EMBED_LIBRARY=ON`) | none | ✅ builds + bundles green on CI |
| macOS x86_64 | `metal` | **static** | none | ✅ builds + bundles green on CI (cross-compiled from the arm64 runner) |
| x86_64 Linux gnu | `dynamic-backends` + `vulkan` | **shared** + backend-DL | `libtranscribe.so` + ggml backend modules (Vulkan + per-ISA CPU) | ✅ builds + bundles green. **Artifact audit caught a placement bug**: Tauri nests the libs at `/usr/lib/transcribe-libs/`, but the rpath pointed at `/usr/lib` — a shipped deb/rpm/AppImage would load zero devices. Fixed by re-pointing the rpath (below). Runtime `devices()` smoke still pending. |
| x86_64 Windows msvc | `dynamic-backends` + `vulkan` | **shared** + backend-DL | `transcribe.dll` + ggml DLLs + per-ISA CPU modules | ❌ **does not compile on CI.** `transcribe-cpp-sys` Vulkan CMake fails: `find_package(SPIRV-Headers)` cannot find the SDK config because `$VULKAN_SDK` is not on `CMAKE_PREFIX_PATH`. A Vulkan-backend build blocker, entangled with the `Backend::Vulkan`-as-Windows-default question. The audit never ran here. |
| aarch64 Windows msvc | `default-features = false` | **static** (portable CPU) | none | not in CI matrix; static, no Vulkan; add a row only if ARM Windows ships |

**Local cross-build is not feasible** (host is `aarch64-apple-darwin`, no cross targets / `cross` / `zig`; the sys crate is a native CMake ggml build linking the Vulkan SDK, and MSVC cannot be produced from macOS). Each non-mac target must build on its own native runner — which the release matrix already provides. This is exactly why the two problems above stayed invisible until a real runner built the bundle.

### The load-bearing risk: shared libs + dlopen modules must be bundled

`transcribe-cpp-sys/build.rs` maps `dynamic-backends → shared + TRANSCRIBE_GGML_BACKEND_DL=ON`: on Linux/Windows-x64 the compute backends become **separate loadable module files next to `libtranscribe`**, picked at runtime by `transcribe_init_backends()`. Its own comment: *"without them a relocated DL build registers zero compute devices."* macOS/Win-arm are static, so nothing ships there — which is exactly why the spike worked on macOS with no packaging at all, and why the risk is invisible until a non-mac bundle is built.

A compile-green Linux/Windows build is therefore **not** proof of a working app: the installer can still ship without the modules and register zero devices.

### Bundling wiring added in this pass (packaging only; no migration, transcribe-rs untouched)

The sys crate forwards its output dirs as `DEP_TRANSCRIBE_CPP_RUNTIME_DIR` / `_MODULE_DIR` (present only in the shared posture). As committed:

- **`src-tauri/build.rs`** — copies the runtime libs + backend modules into a stable, git-ignored `src-tauri/transcribe-libs/` (by name, dereferencing Linux SONAME symlinks), and **hard-fails** if a shared build advertised a dir but staged zero files. Inert on the static targets (env vars unset → folder stays empty). On Linux it also emits the rpath so `libtranscribe` is found: the sys lib dir for `tauri dev`, and **`$ORIGIN/../lib/transcribe-libs`** for the installed bundle. That last path is the fix from the CI finding: Tauri's linux `files` mapping does not flatten a directory source, so the libs sit in `/usr/lib/transcribe-libs/`, not `/usr/lib`. Windows needs no rpath (DLLs resolve from the exe dir) and macOS is static.
- **Linux bundle (`tauri.conf.json`)** — `bundle.linux.{deb,rpm,appimage}.files` maps `{"/usr/lib": "transcribe-libs"}`. Tauri copies the `transcribe-libs` **directory** under `/usr/lib` preserving its name, so the files land in `/usr/lib/transcribe-libs/`. There is no glob/trailing-slash flatten in `files` (verified against the observed package contents); per-file entries would be the only way to flatten, and they cannot enumerate the build-dependent per-ISA `libggml-cpu-*.so` names — so the rpath is pointed at the nested dir instead.
- **Windows bundle (`tauri.windows.conf.json`)** — `bundle.resources` maps `{"transcribe-libs": "."}`. Unlike the linux `files` map, `bundle.resources` **does** flatten a directory-to-`"."` mapping into the `$RESOURCES` root, which on Windows is the executable's own directory (confirmed against `tauri-utils` resource-walk tests), satisfying the load-time DLL search. This merges additively with the base `resources` (the recorder-state PNGs) via the platform-config JSON Merge Patch.
- **`gguf_spike.rs`** — `init_transcribe_cpp_backends` calls `init_backends_default()`, which scans the directory of the loaded `libtranscribe` for its modules. Layout-correct on every target because the bundle stages `libtranscribe` and its modules into the **same** directory: `/usr/lib/transcribe-libs` on Linux (reached by the rpath), the exe dir on Windows, and the sys crate's own output dir for a dev build. No-op on the static builds.

### Residual gate before deleting transcribe-rs (Phase 1 step 4)

macOS is proven and inert. The non-mac path is now partially runner-proven, and the CI pass moved several of these gates from "unknown" to "known and specific". Before the transcribe-rs deletion in step 4 is safe, all of the following must hold; none of them do yet:

1. **Windows x64 must actually compile.** It currently fails at the `transcribe-cpp-sys` Vulkan CMake step (`find_package(SPIRV-Headers)` cannot find the SDK config). This is a build-toolchain gap in `setup-whispering-build` (point `CMAKE_PREFIX_PATH` at `$VULKAN_SDK`, or install the SDK's SPIRV-Headers component), but it is entangled with a **product decision**: whether `Backend::Vulkan` should be the Windows x64 default at all (see the smells below). Do not paper over it with a CI one-liner without settling that.
2. **Windows VC++ / OpenMP runtime staging.** Handy stages `msvcp140.dll` + `vcruntime140.dll` (all builds) and `vcomp140.dll` (x64 OpenMP) beside the exe; Whispering stages none. If the x64 ggml-cpu module links OpenMP, a machine without the redist registers zero devices. Unproven until Windows builds.
3. **Runtime `devices()` smoke on x86_64 Linux and x86_64 Windows.** Build the bundle, launch it, assert `transcribe_cpp::devices()` ≥ 1 and one GGUF transcription succeeds. Whispering has no `--list-devices` CLI (Handy's smoke), so this needs a Whispering-native harness. The static artifact audit added in this pass is a weaker proxy that already earned its keep by catching the Linux `/usr/lib/transcribe-libs` placement bug.

The Linux `/usr/lib/transcribe-libs` rpath fix is committed but its **runtime** resolution is still only asserted statically (the libs are in the package at the rpath location); the `devices()` smoke is what proves the loader actually finds them. Until items 1–3 are green, deleting transcribe-rs would ship a broken or zero-device Linux/Windows build. macOS may proceed independently.

## Compatibility paths refused (the explicit break list)

Every refusal below is a deliberate clean break the user has authorised. User-visible loss is stated for each.

1. **Existing downloaded ONNX Parakeet models** (`{app_data}/models/parakeet/…`) — refused. **Loss:** the file is orphaned on disk; the user must download a GGUF Parakeet from Hugging Face and re-select it. No auto-migration, no reuse.
2. **Existing downloaded ONNX Moonshine models** — refused. **Loss:** orphaned on disk; re-download a supported GGUF (or drop Moonshine entirely if no `handy-computer` GGUF equivalent is curated) and re-select.
3. **Existing downloaded GGML Whisper `.bin` models** — refused as a *runtime* path even though the bytes are GGML. **Loss:** the old `.bin` is not reused by transcribe.cpp's GGUF loader; the user re-downloads a Whisper **GGUF** from `handy-computer` and re-selects. (transcribe.cpp reads GGUF, not legacy GGML `.bin`.)
4. **The stored local-model selection** (`deviceConfig['transcription.{whispercpp,parakeet,moonshine}.model']`) — refused. **Loss:** the previously selected local model is forgotten; the user picks a model once after updating. Cheap because the value is device-local and never synced (no contract).
5. **Per-engine model folders** (`{app_data}/models/{whisper,parakeet,moonshine}/`) — refused as live locations. **Loss:** disk space held by orphaned models until the user clears it (a one-line "these can be deleted" note in release copy suffices; no cleanup migration is written).
6. **"Bring your own ONNX model" via symlink/drop-in** for the transcribe-rs engines — refused. **Loss:** users who hand-dropped ONNX/GGML models lose that path; the GGUF drop-in equivalent is a later earned feature (Open questions), not a compatibility carry-over.
7. **The static per-provider `capabilities` flags for local providers** — refused in favour of Rust per-model capability. **Loss:** none user-visible; internal shape change.
8. **Dual catalog ownership (TS `local-models.ts`)** — refused. **Loss:** none user-visible; the catalog moves to Rust.

Not refused (unchanged): all cloud/self-hosted providers, the recording pipeline, blob storage, the resident-cache/unload lifecycle, disk-identity reuse logic (carried onto the GGUF path).

## What Handy did (reference, do not copy blindly)

- Rust-owned catalog + `ModelInfo` capabilities + GGUF header probe — **adopt.** This is the target owner.
- `ModelSource` three-way discriminant — **simplify to one** (HF coordinate) for the core target; Handy kept `Url` for its own legacy hosting, which greenfield Whispering has no reason to carry.
- hf-hub shared cache — adopt if the clean-uninstall story allows it (Open questions); otherwise download GGUF to an app-data folder via the existing streamer.
- `transcribe-cpp` per-target feature tables — copy the *structure*, re-derive against Whispering's feature set. MIT-licensed; preserve attribution if non-trivial code is lifted.
- Handy's `is_custom` / discover-from-disk / dedup-with-cache machinery — defer; earned only when "add your own GGUF" ships.

## Rejected alternatives

- **Preserve old local models / write migration readers.** Refused by the greenfield stance; no durable or synced contract makes this compatibility real, so it is pure complexity.
- **Keep dual catalog ownership (TS + Rust).** Existed only to dodge migration; with migration refused there is no reason for a second owner.
- **Keep transcribe-rs as a supported second runtime.** Two runtimes, two capability models, two download shapes, two dispatch arms — all to serve models the product no longer offers. Refused; transcribe-rs is deleted in the same pass that adds GGUF (Deletion inventory).
- **Sunset transcribe-rs as unreferenced compiling code.** Refused: it has no unrelated coupling (audit above), so there is no reason to keep it compiling; deleting it now removes the `Engine` discriminant outright.
- **Retain the folder-entry-name identity beside the HF coordinate.** Two identities for one value; refused.
- **Start with a TS catalog reshape.** Throwaway — the TS catalog is deleted.

## Blockers before realtime (Phase 2)

- Batch GGUF (Phase 1) must be proven first; a streaming session reuses the loaded-model lifecycle.
- transcribe-cpp streaming session API (partial-hypothesis cadence, finalisation, cancellation) is unverified against the crate.
- Recorder/VAD coupling: streaming needs live audio frames mid-capture, which the stop-then-transcribe recorder contract does not emit. Design with the recorder/Voice-Cursor work, not around it.
- `ModelStateEvent` and the model-selector UX assume batch; streaming adds states (`Streaming`, partial text) they must represent.

## Open questions

- **Shared HF cache vs app-data GGUF folder.** The spike uses the shared HF cache because it is the shortest path through `hf-hub`. The product path still needs an explicit choice: cross-tool reuse (`~/.cache/huggingface/hub`) or app-owned cleanup/portability under app data. Trigger to revisit: first user report about disk usage or uninstall leftovers.
- **Which `handy-computer` GGUF anchors the product catalog.** The spike uses Whisper Small GGUF because it is closest to current Whisper behaviour and a safe multilingual default. The first product catalog can still choose Parakeet GGUF if that is the user-facing win.
- **Rust-generated catalog vs hand-curated list.** Hand-curate a handful now. Trigger to revisit: the curated list exceeds ~15 entries or needs per-release capability refresh from the HF org.
- **"Add your own GGUF" drop-in.** A real product operation (rename/delete/list a user-provided model), so earned — but not in this pass. Trigger: a user asks to run a non-catalog GGUF.
