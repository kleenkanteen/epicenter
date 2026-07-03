#!/usr/bin/env bash
#
# Tauri dev `build.runner` for macOS: build, codesign, then become the app.
#
# Why this exists
# ---------------
# `tauri dev` runs the bare `target/debug/whispering` binary, never a `.app`
# bundle, and `bundle.macOS.signingIdentity` is ignored in dev. Cargo's linker
# leaves the binary ad-hoc signed, so its code-signing identity is its cdhash:
# a fresh hash on every relink. macOS Accessibility (TCC) keys the grant on that
# identity, so every Rust rebuild looks like a brand-new app and the grant goes
# stale, which the Rust supervisor then surfaces as DictationCapability::Broken.
#
# Tauri offers no after-build/before-launch hook, but it does let you replace
# cargo with a custom `build.runner` that it invokes as `<runner> run <args>`
# and then treats as the long-lived app process (it kills this PID to restart
# on file changes). So this runner does the one thing dev is missing: it builds,
# overwrites the ad-hoc signature with a fixed identifier-only designated
# requirement, then `exec`s the binary so Tauri's monitored PID is the app
# itself.
#
# The fixed identifier (so.epicenter.whispering.dev, not the production
# so.epicenter.whispering) keeps dev and production as separate TCC entries. The
# explicit requirement keeps the dev TCC grant tied to the identifier instead of
# the changing cdhash.
#
# This runner is wired in only on macOS (see scripts/launch-dev.ts); other
# platforms run plain `tauri dev`.
set -euo pipefail

# The dev TCC identity. Keep in lockstep with tauri.dev.conf.json and
# tests/dev-identity.test.ts (the regression guard asserts they match).
readonly DEV_IDENTIFIER="so.epicenter.whispering.dev"

# Resolve src-tauri from this script's location so cargo and the binary path are
# correct regardless of the cwd Tauri happens to invoke us with.
SRC_TAURI="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Tauri calls us as `run <cargo flags...> [-- <app args...>]`. Drop `run`, then
# split cargo flags from the app args at the `--` separator.
shift || true
cargo_flags=()
app_args=()
seen_separator=0
for arg in "$@"; do
	if [ "$seen_separator" -eq 1 ]; then
		app_args+=("$arg")
	elif [ "$arg" = "--" ]; then
		seen_separator=1
	else
		cargo_flags+=("$arg")
	fi
done

# `--bin whispering` mirrors the default `cargo run` Tauri would invoke: build the
# app binary and its deps, not every target (a bare `cargo build` also produces
# the lib's multi-hundred-MB staticlib, which the app never needs).
# The `${arr[@]+"${arr[@]}"}` form expands to nothing when the array is empty,
# which `set -u` otherwise rejects on the bash 3.2 that ships with macOS.
cargo build --manifest-path "$SRC_TAURI/Cargo.toml" --bin whispering ${cargo_flags[@]+"${cargo_flags[@]}"}

# Mirror cargo's output layout to find what we just built: honor CARGO_TARGET_DIR
# and any --target/--release the flags carried.
target_dir="${CARGO_TARGET_DIR:-$SRC_TAURI/target}"
profile="debug"
triple=""
index=0
while [ "$index" -lt "${#cargo_flags[@]}" ]; do
	case "${cargo_flags[$index]}" in
		--release) profile="release" ;;
		--target) index=$((index + 1)); triple="${cargo_flags[$index]:-}" ;;
		--target=*) triple="${cargo_flags[$index]#--target=}" ;;
	esac
	index=$((index + 1))
done
binary="$target_dir/${triple:+$triple/}$profile/whispering"

codesign --force \
	--sign - \
	--identifier "$DEV_IDENTIFIER" \
	--requirements "=designated => identifier \"$DEV_IDENTIFIER\"" \
	--entitlements "$SRC_TAURI/entitlements.plist" \
	"$binary"

# Become the app. Tauri monitors and kills THIS pid to restart, so replacing the
# process (rather than spawning a child) means no orphaned app on rebuild. The
# array guard matters here: Tauri usually passes no app args, so `app_args` is
# empty, and a bare "${app_args[@]}" would trip `set -u` and abort before exec.
exec "$binary" ${app_args[@]+"${app_args[@]}"}
