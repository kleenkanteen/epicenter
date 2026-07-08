# Transcription Services

This directory organizes transcription providers (service implementations):

**`/cloud`**: API-based services that send audio to external providers. Require API keys and internet connection.

**`/self-hosted`**: Services that connect to servers you deploy yourself on your own machine. You provide the base URL of your own instance.

**The `local` provider** has no JS transcription service. Rust owns the GGUF model catalog, capabilities, download, shared-HF-cache resolution, and transcribe.cpp inference (`src-tauri/src/transcription/`). The webview stores one selected model id (`transcription.local.selectedModel`) and dispatches through the `transcribe_recording` Tauri command; dispatch is inlined in `$lib/operations/transcribe.ts`. The catalog and per-model download status come from the `list_models` command, projected by the `$lib/state/local-models.svelte.ts` store (catalog scan plus in-flight downloads); `download_model` / `cancel_download` / `delete_model` drive the picker.
