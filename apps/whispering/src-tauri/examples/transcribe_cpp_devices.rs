//! Runtime smoke for the transcribe-cpp `dynamic-backends` posture.
//!
//! The Linux / x86_64-Windows builds link `transcribe-cpp` `shared` +
//! `dynamic-backends`, so the ggml compute backends are separate module files
//! (`libggml-cpu-*.so` / `ggml-cpu-*.dll`, plus Vulkan) that `libtranscribe`
//! dlopen's at init. The static CI artifact audits prove those files are *in*
//! the shipped packages beside `libtranscribe`; they do NOT prove the loader
//! resolves them and registers a compute device. A compile-green build can
//! still ship a bundle that registers zero devices.
//!
//! This example is the missing runtime proof: it initializes the backends the
//! way the app does (`transcribe-cpp`'s own `init_backends*`) and asserts at
//! least one compute device registered. It exits non-zero (and emits a GitHub
//! `::error::` line) on failure so `pr-preview.whispering.yml` can gate on it.
//! It is an example, not a bin or a test: it must reuse the release artifacts
//! the bundle was built from with no `panic=unwind` test-harness rebuild and no
//! per-profile native cmake rebuild, and it deliberately references only
//! `transcribe-cpp` (not `whispering_lib`) so the smoke is the runtime loader
//! and nothing else.
//!
//! Usage:
//!   transcribe_cpp_devices [MODULE_DIR]
//! With no argument it mirrors the app: `init_backends_default()` scans the
//! directory of the loaded `libtranscribe`. CI passes the staged
//! `transcribe-libs/` directory explicitly so the smoke proves the EXACT files
//! the installer ships register a device, independent of where the OS loader
//! happened to resolve `libtranscribe` from.

use std::process::ExitCode;

fn main() -> ExitCode {
    transcribe_cpp::init_logging();

    let module_dir = std::env::args().nth(1);
    let init = match module_dir.as_deref() {
        Some(dir) => {
            eprintln!("transcribe-cpp smoke: init_backends(\"{dir}\")");
            transcribe_cpp::init_backends(dir)
        }
        None => {
            eprintln!("transcribe-cpp smoke: init_backends_default()");
            transcribe_cpp::init_backends_default()
        }
    };
    if let Err(e) = init {
        eprintln!("::error::transcribe-cpp backend init failed: {e}");
        return ExitCode::FAILURE;
    }

    let devices = transcribe_cpp::devices();
    eprintln!("transcribe-cpp registered {} compute device(s):", devices.len());
    for d in &devices {
        eprintln!("  - {} [{}] {}", d.name, d.kind, d.description);
    }
    if devices.is_empty() {
        eprintln!("::error::transcribe-cpp registered zero compute devices");
        return ExitCode::FAILURE;
    }

    eprintln!("transcribe-cpp runtime smoke passed: >= 1 compute device registered.");
    ExitCode::SUCCESS
}
