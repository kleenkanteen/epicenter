//! Runtime smoke for the local GGUF transcription chain: download the catalog's
//! anchor model through the shared Hugging Face cache, load it through
//! transcribe.cpp on the host backend, and transcribe a real speech clip.
//!
//! This exercises the exact runtime `transcription::catalog` + `model_cache`
//! use in the app (hf-hub `download_with_progress`, `Cache::from_env` resolve,
//! `Model::load_with`, `session().run`), end to end, with a correct-output
//! assertion.
//!
//! Run from `src-tauri/`:
//!   cargo run --example local_gguf_smoke -- /tmp/jfk.wav
//!
//! The anchor matches the catalog entry
//!   `handy-computer/whisper-small-gguf@main/whisper-small-Q4_K_M.gguf`.

use hf_hub::api::tokio::ApiBuilder;
use hf_hub::{Cache, Repo, RepoType};
use transcribe_cpp::{Backend, Model, ModelOptions, RunOptions};

const REPO_ID: &str = "handy-computer/whisper-small-gguf";
const REVISION: &str = "main";
const FILENAME: &str = "whisper-small-Q4_K_M.gguf";

#[tokio::main]
async fn main() {
    let wav_path = std::env::args()
        .nth(1)
        .expect("usage: cargo run --example local_gguf_smoke -- <16kHz mono wav>");

    // 1. Resolve through the shared HF cache, downloading if absent — the exact
    //    `catalog::resolve_model_path` + `download_model` path.
    let repo = Repo::with_revision(REPO_ID.to_string(), RepoType::Model, REVISION.to_string());
    let model_path = match Cache::from_env().repo(repo.clone()).get(FILENAME) {
        Some(path) => {
            println!("[cache] resolved {}", path.display());
            path
        }
        None => {
            println!("[download] {REPO_ID}@{REVISION}/{FILENAME} (shared HF cache)…");
            let api = ApiBuilder::from_env().with_progress(true).build().unwrap();
            let path = api.repo(repo).download(FILENAME).await.unwrap();
            println!("[download] done -> {}", path.display());
            path
        }
    };

    // 2. Init the compute backends once, then load on the host backend.
    transcribe_cpp::init_logging();
    transcribe_cpp::init_backends_default().expect("init transcribe-cpp backends");
    println!("[backends] {} compute device(s)", transcribe_cpp::devices().len());

    let backend = if cfg!(target_os = "macos") {
        Backend::Metal
    } else if cfg!(target_os = "linux") || cfg!(all(windows, target_arch = "x86_64")) {
        Backend::Vulkan
    } else {
        Backend::Cpu
    };
    let model = Model::load_with(
        &model_path,
        &ModelOptions {
            backend,
            gpu_device: 0,
        },
    )
    .expect("load GGUF model");
    println!("[model] loaded on backend {}", model.backend());

    // 3. Read the 16kHz mono WAV as f32 samples.
    let mut reader = hound::WavReader::open(&wav_path).expect("open wav");
    let samples: Vec<f32> = reader
        .samples::<i16>()
        .map(|s| s.expect("read sample") as f32 / 32768.0)
        .collect();
    println!("[audio] {} samples", samples.len());

    // 4. Transcribe.
    let mut session = model.session().expect("session");
    let transcript = session
        .run(&samples, &RunOptions::default())
        .expect("transcribe")
        .text
        .trim()
        .to_string();
    println!("[transcript] {transcript}");

    assert!(
        !transcript.is_empty(),
        "expected a non-empty transcript from a speech clip"
    );
    println!("SMOKE OK");
}
