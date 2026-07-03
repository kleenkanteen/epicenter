use super::error::TranscriptionError;
use crate::recorder::read_artifact_samples;
use hf_hub::api::tokio::ApiBuilder;
use hf_hub::{Cache, Repo, RepoType};
use log::{info, warn};
use std::path::PathBuf;
use std::sync::Once;
use tauri::AppHandle;
use transcribe_cpp::{
    Backend, Feature, Model, ModelOptions, RunExtension, RunOptions, WhisperRunOptions,
};

const ANCHOR_REPO_ID: &str = "handy-computer/whisper-small-gguf";
const ANCHOR_REVISION: &str = "main";
const ANCHOR_FILENAME: &str = "whisper-small-Q4_K_M.gguf";

static INIT_TRANSCRIBE_CPP: Once = Once::new();

/// Initialize the transcribe-cpp compute backends exactly once.
///
/// `init_backends_default()` scans the directory of the loaded `libtranscribe`
/// for its dlopen'd ggml modules. That is exactly our layout on every target:
/// the bundle stages `libtranscribe` AND its modules into the same directory
/// beside the executable (Linux `/usr/lib` on the `$ORIGIN/../lib` rpath;
/// x86_64-Windows the install root beside the exe via `tauri.windows.conf.json`),
/// and a dev
/// build loads `libtranscribe` from the sys crate's own output dir where the
/// modules were just built. So no explicit module path is needed. On the static
/// targets (macOS Metal, aarch64 Windows) it is a no-op: the backends are already
/// compiled in.
pub fn init_transcribe_cpp_backends() {
    INIT_TRANSCRIBE_CPP.call_once(|| {
        transcribe_cpp::init_logging();
        match transcribe_cpp::init_backends_default() {
            Ok(()) => {
                let devices = transcribe_cpp::devices();
                info!(
                    "transcribe-cpp initialized with {} compute device(s)",
                    devices.len()
                );
            }
            Err(e) => warn!("Failed to initialize transcribe-cpp backends: {}", e),
        }
    });
}

#[tauri::command]
#[specta::specta]
pub async fn transcribe_recording_with_hf_gguf_spike(
    recording_id: String,
    language: Option<String>,
    initial_prompt: Option<String>,
    app_handle: AppHandle,
) -> Result<String, TranscriptionError> {
    let samples = crate::timing::measure("transcribe.gguf_spike.read+decode", || {
        read_artifact_samples(&app_handle, &recording_id)
    })
    .map_err(|e| TranscriptionError::AudioReadError {
        message: e.to_string(),
    })?;

    if samples.is_empty() {
        return Ok(String::new());
    }

    let model_path = resolve_anchor_model_path().await?;
    tauri::async_runtime::spawn_blocking(move || {
        transcribe_anchor_model(samples, model_path, language, initial_prompt)
    })
    .await
    .map_err(|e| TranscriptionError::TranscriptionError {
        message: format!("Background GGUF transcription task failed: {}", e),
    })?
}

async fn resolve_anchor_model_path() -> Result<PathBuf, TranscriptionError> {
    if let Some(path) = hf_cached_path(ANCHOR_REPO_ID, ANCHOR_REVISION, ANCHOR_FILENAME) {
        return Ok(path);
    }

    info!(
        "Downloading GGUF spike anchor model from {}@{} ({})",
        ANCHOR_REPO_ID, ANCHOR_REVISION, ANCHOR_FILENAME
    );
    let api = ApiBuilder::from_env()
        .with_progress(false)
        .with_max_files(8)
        .build()
        .map_err(|e| TranscriptionError::ModelLoadError {
            message: format!("Failed to initialize Hugging Face API: {}", e),
        })?;
    let repo = api.repo(Repo::with_revision(
        ANCHOR_REPO_ID.to_string(),
        RepoType::Model,
        ANCHOR_REVISION.to_string(),
    ));
    repo.download(ANCHOR_FILENAME)
        .await
        .map_err(|e| TranscriptionError::ModelLoadError {
            message: format!("Failed to download GGUF spike anchor model: {}", e),
        })
}

fn hf_cached_path(repo_id: &str, revision: &str, filename: &str) -> Option<PathBuf> {
    Cache::from_env()
        .repo(Repo::with_revision(
            repo_id.to_string(),
            RepoType::Model,
            revision.to_string(),
        ))
        .get(filename)
}

fn transcribe_anchor_model(
    samples: Vec<f32>,
    model_path: PathBuf,
    language: Option<String>,
    initial_prompt: Option<String>,
) -> Result<String, TranscriptionError> {
    init_transcribe_cpp_backends();

    let model_options = ModelOptions {
        backend: default_backend(),
        gpu_device: 0,
    };
    let model = Model::load_with(&model_path, &model_options).map_err(|e| {
        TranscriptionError::ModelLoadError {
            message: format!(
                "Failed to load GGUF spike model {}: {}",
                model_path.display(),
                e
            ),
        }
    })?;
    let mut session = model
        .session()
        .map_err(|e| TranscriptionError::ModelLoadError {
            message: format!("Failed to create GGUF spike session: {}", e),
        })?;

    let accepts_initial_prompt = session.model().supports(Feature::InitialPrompt);
    let family =
        if accepts_initial_prompt && initial_prompt.as_ref().is_some_and(|prompt| !prompt.is_empty())
        {
            Some(RunExtension::Whisper(WhisperRunOptions {
                initial_prompt,
                ..Default::default()
            }))
        } else {
            None
        };
    let run_options = RunOptions {
        language,
        family,
        ..Default::default()
    };

    session
        .run(&samples, &run_options)
        .map(|transcript| transcript.text.trim().to_string())
        .map_err(|e| TranscriptionError::TranscriptionError {
            message: format!("transcribe-cpp GGUF spike transcription failed: {}", e),
        })
}

fn default_backend() -> Backend {
    #[cfg(target_os = "macos")]
    {
        Backend::Metal
    }
    #[cfg(all(windows, target_arch = "x86_64"))]
    {
        Backend::Vulkan
    }
    #[cfg(target_os = "linux")]
    {
        Backend::Vulkan
    }
    #[cfg(not(any(
        target_os = "macos",
        all(windows, target_arch = "x86_64"),
        target_os = "linux"
    )))]
    {
        Backend::Cpu
    }
}
