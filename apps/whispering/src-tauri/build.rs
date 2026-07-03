//! Whispering Tauri build script.
//!
//! Beyond the standard `tauri_build::build()`, this stages transcribe-cpp's
//! runtime files for the Linux / x86_64-Windows `dynamic-backends` posture and
//! bakes the Linux rpath the shared `libtranscribe` needs at runtime.
//!
//! transcribe-cpp links STATICALLY on macOS (Metal, embedded metallib) and on
//! aarch64 Windows (portable CPU): everything is baked into the app binary, so
//! there is nothing to ship. On Linux and x86_64 Windows it is built `shared` +
//! `dynamic-backends`, which produces a separate `libtranscribe` / `transcribe.dll`
//! PLUS dlopen-loaded ggml backend modules. Those files must travel next to the
//! app binary; without them a relocated build registers zero compute devices.
//!
//! transcribe-cpp-sys forwards its native output dirs to us as `DEP_TRANSCRIBE_CPP_*`
//! (it declares `links = "transcribe_cpp"`, so cargo hands the metadata to this,
//! its immediate dependent's, build script). We copy those files into a stable,
//! git-ignored `transcribe-libs/` folder, then let Tauri place them beside the
//! executable per platform, matching upstream Handy:
//!   * Linux: `tauri.conf.json` maps `transcribe-libs -> /usr/lib` for deb / rpm /
//!     appimage, and the binary installs to `/usr/bin`, so the `$ORIGIN/../lib`
//!     rpath baked below resolves `libtranscribe`.
//!   * Windows: `tauri.windows.conf.json` maps `transcribe-libs -> .` (the install
//!     root beside `Whispering.exe`); Windows resolves DLLs from the exe dir, so
//!     no rpath is needed.
//!   * macOS: static build, nothing staged, no rpath, folder stays empty.

use std::collections::BTreeSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    bake_transcribe_rpath();
    stage_transcribe_runtime();
    tauri_build::build();
}

/// Bake the rpaths the shared `libtranscribe` needs on Linux. Windows resolves
/// DLLs from the exe directory and macOS links transcribe-cpp statically via
/// `metal`, so neither needs an rpath. Matches Handy.
fn bake_transcribe_rpath() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("linux") {
        return;
    }

    // Installed bundle: `tauri.conf.json` maps `transcribe-libs` into `/usr/lib`
    // and the binary installs to `/usr/bin`, so `$ORIGIN/../lib` resolves
    // `libtranscribe`. `$ORIGIN` reaches the linker verbatim (cargo does not
    // shell-expand). This is the only rpath a shipped build needs.
    println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN/../lib");

    // Dev / `cargo run` (no bundle yet): also point at the sys crate's own build
    // output so `libtranscribe` resolves before there is an installed layout. The
    // path is absolute and host-only, so the loader simply skips it on a user
    // machine. This is necessary because neither transcribe-cpp-sys nor its
    // wrapper propagate a runtime rpath to a downstream binary (`rustc-link-arg`
    // is not transitive across the `links` boundary), so without this Linux dev
    // builds cannot find `libtranscribe`.
    println!("cargo:rerun-if-env-changed=DEP_TRANSCRIBE_CPP_LIB_DIR");
    if let Some(lib_dir) = env::var_os("DEP_TRANSCRIBE_CPP_LIB_DIR") {
        println!(
            "cargo:rustc-link-arg=-Wl,-rpath,{}",
            Path::new(&lib_dir).display()
        );
    }
}

/// Copy transcribe-cpp's shared libraries + backend modules into
/// `transcribe-libs/` for Tauri to bundle, or leave it empty on static targets.
fn stage_transcribe_runtime() {
    for var in [
        "DEP_TRANSCRIBE_CPP_RUNTIME_DIR",
        "DEP_TRANSCRIBE_CPP_MODULE_DIR",
    ] {
        println!("cargo:rerun-if-env-changed={var}");
    }

    let staging =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("transcribe-libs");

    // `RUNTIME_DIR` is emitted only for a shared / dynamic-backends build. Absent
    // => static posture (macOS Metal, aarch64 Windows): nothing to bundle. Still
    // recreate the folder EMPTY, because `tauri.windows.conf.json` maps
    // `transcribe-libs -> .` unconditionally on Windows and Whispering (unlike
    // Handy) stages no other DLLs to create it; a clean empty dir also guarantees
    // a prior shared build's `.so` / `.dll` cannot linger into a static package.
    let Some(runtime_dir) = env::var_os("DEP_TRANSCRIBE_CPP_RUNTIME_DIR") else {
        let _ = fs::remove_dir_all(&staging);
        fs::create_dir_all(&staging).expect("create transcribe-libs staging dir");
        return;
    };

    // Recreate clean so a renamed or dropped ggml module can never linger in the
    // package from a previous build.
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).expect("create transcribe-libs staging dir");

    // `RUNTIME_DIR` (core libs) and `MODULE_DIR` (the dlopen'd ggml backend
    // modules, `dynamic-backends` only) may be the SAME directory (they are on
    // Linux); dedup so we copy each file once. Both must sit next to the
    // executable, or `init_backends_default()` finds the core libs but zero
    // loadable compute backends and registers no devices.
    let mut dirs = BTreeSet::new();
    dirs.insert(PathBuf::from(runtime_dir));
    if let Some(module_dir) = env::var_os("DEP_TRANSCRIBE_CPP_MODULE_DIR") {
        dirs.insert(PathBuf::from(module_dir));
    }

    let mut copied = 0;
    for dir in &dirs {
        println!("cargo:rerun-if-changed={}", dir.display());
        copied += copy_libs(dir, &staging);
    }
    assert!(
        copied > 0,
        "no transcribe-cpp runtime libraries found under {dirs:?}; a shared / \
         dynamic-backends build must ship them or the app registers zero compute devices"
    );
    println!("cargo:warning=Staged {copied} transcribe-cpp runtime library file(s)");
}

/// True for a shared-library filename on any desktop platform. Match by NAME,
/// not a single extension: Linux versions its libs (`libtranscribe.so.0`,
/// `.so.0.0.4`) and the loader needs the SONAME, so an extension-only filter
/// would ship only the bare dev symlink and a broken installer.
fn is_lib(name: &str) -> bool {
    name.ends_with(".dll")
        || name.ends_with(".dylib") // macOS versions before the ext: libfoo.0.dylib
        || name.ends_with(".so")
        || name.contains(".so.") // Linux SONAME / version: libfoo.so.0[.0.4]
}

/// Copy every shared library / module out of `src` into `dest`, dereferencing
/// version symlinks into real files (`fs::copy` follows them). Returns the count.
fn copy_libs(src: &Path, dest: &Path) -> usize {
    let Ok(entries) = fs::read_dir(src) else {
        return 0;
    };
    let mut n = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if is_lib(name) {
            fs::copy(&path, dest.join(name))
                .unwrap_or_else(|e| panic!("copy {} into staging: {e}", path.display()));
            n += 1;
        }
    }
    n
}
