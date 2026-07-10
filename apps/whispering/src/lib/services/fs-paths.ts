/**
 * Tauri path helpers for Whispering's appdata directories.
 *
 * Tauri derives this root from `appDataDir()`, i.e.
 * `${dataDir}/${bundleIdentifier}`. With identifier
 * `so.epicenter.app`, that means:
 *   macOS:   ~/Library/Application Support/so.epicenter.app/
 *   Windows: %APPDATA%/so.epicenter.app/
 *   Linux:   ~/.local/share/so.epicenter.app/
 *
 * This module must stay importable from browser builds because Svelte routes
 * and components statically import it while guarding calls with `tauri`. Keep
 * Tauri API loading lazy unless every importer moves behind a `.tauri` suffix.
 */
import { once } from 'wellcrafted/function';

const getTauriPathApi = once(() => import('@tauri-apps/api/path'));

async function appDataPath(...segments: string[]) {
	const { appDataDir, join } = await getTauriPathApi();
	return join(await appDataDir(), ...segments);
}

export const PATHS = {
	/**
	 * Filesystem storage for recording audio blobs: `recordings/{id}.{ext}`.
	 * Local models are not here: Rust owns them end to end in the shared Hugging
	 * Face cache (see `src-tauri/src/transcription/catalog.rs`), so JS never
	 * resolves a model path.
	 */
	DB: {
		/** `recordings/` directory containing audio files. */
		async RECORDINGS() {
			return appDataPath('recordings');
		},
		/** Path for a newly written recording: `recordings/{id}.{extension}`. */
		async RECORDING_AUDIO(id: string, extension: string) {
			return appDataPath('recordings', `${id}.${extension}`);
		},
		/** Path to an existing recording file given its full filename. */
		async RECORDING_FILE(filename: string) {
			return appDataPath('recordings', filename);
		},
	},
};
