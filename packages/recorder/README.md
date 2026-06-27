# @epicenter/recorder

Portable browser audio capture and voice-activity detection. The reusable core
of Whispering's recording stack, with no app glue: no settings store, no tables,
no transcription, no UI. It hands back a `Blob` plus level and speech callbacks.

The native Tauri/CPAL recorder is intentionally not here; it stays in the app
behind that app's own platform seam. This package is the browser-portable half.

## Public API

```ts
import {
  // Device stream (navigator.mediaDevices)
  getRecordingStream,
  enumerateDevices,
  cleanupRecordingStream,
  WHISPER_RECOMMENDED_MEDIA_TRACK_CONSTRAINTS,
  DeviceStreamError,

  // Manual recorder (MediaRecorder)
  createBrowserRecorder,

  // Voice activity detection (Silero v5 via @ricky0123/vad-web)
  createVadRecorder,

  // Level meter smoothing
  foldMicLevel,

  // Contract + helpers
  asDeviceIdentifier,
} from '@epicenter/recorder';
```

Types: `RecorderService`, `RecordingSession`, `RecorderStopResult`
(`artifact | blob`), `RecordingArtifact`, `RecorderError`, `RecordingState`,
`Device`, `DeviceIdentifier`, `DeviceAcquisitionOutcome`, `VadState`,
`VadRecorder`, `VadRecorderError`.

The core is callback and `Result` based, with no framework reactivity. A Svelte
app that wants reactive state wraps the core in its own thin runes layer (see
Whispering's `vad-recorder.svelte.ts`).

`RecorderStopResult` keeps the `artifact | blob` union so a native recorder and
the browser recorder satisfy one contract. The browser recorder always returns
`blob`; browser-only callers can narrow to it. `RecordingArtifact` is the plain,
portable shape a native recorder's result satisfies structurally.

## VAD runtime assets (required)

`@ricky0123/vad-web` fetches its worklet, Silero ONNX model, and onnxruntime
wasm from a base path at runtime; the files are not bundled. `createVadRecorder`
loads them from `assetBaseUrl` (default `/vad/`). Each consuming app must copy
those files so they are served at that path, or VAD fails to initialize at
runtime (this is not caught by `tsc`).

The package resolves the source paths from its own pinned dependency tree.
Feed them to your build's static-copy step. With Vite:

```ts
// vite.config.ts
import { VAD_ASSET_DEST, vadAssetSources } from '@epicenter/recorder/vad-assets';
import { viteStaticCopy } from 'vite-plugin-static-copy';

viteStaticCopy({
  targets: vadAssetSources.map((src) => ({
    src,
    dest: VAD_ASSET_DEST, // 'vad' -> served at /vad/
    rename: { stripBase: true },
  })),
});
```

If you set a non-default `assetBaseUrl`, serve the files at that path instead.
