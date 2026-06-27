import {
	defineErrors,
	extractErrorMessage,
	type InferErrors,
} from 'wellcrafted/error';
import type { Result } from 'wellcrafted/result';
import type {
	Device,
	DeviceAcquisitionOutcome,
	DeviceIdentifier,
} from '@epicenter/recorder';
import type { WhisperingRecordingState } from '$lib/constants/audio';

// The device-identity types and their cast helper now live in
// `@epicenter/recorder`. Re-export them here so the many in-app consumers of
// `$lib/services/recorder/types` keep their import path during the extraction.
export {
	asDeviceIdentifier,
	type Device,
	type DeviceAcquisitionOutcome,
	type DeviceIdentifier,
} from '@epicenter/recorder';

export const RecorderError = defineErrors({
	EnumerateDevices: ({ cause }: { cause: unknown }) => ({
		message: `Failed to enumerate recording devices: ${extractErrorMessage(cause)}`,
		cause,
	}),
	MicrophonePermissionDenied: ({ cause }: { cause?: unknown } = {}) => ({
		message:
			'Microphone access was denied. Please grant microphone permission in your system or browser settings and try again.',
		cause,
	}),
	NoInputDevice: ({ cause }: { cause?: unknown } = {}) => ({
		message:
			"We couldn't find any microphone to record from. Please connect a microphone and try again.",
		cause,
	}),
	InitFailed: ({ cause }: { cause: unknown }) => ({
		message: `Failed to initialize the audio recorder: ${extractErrorMessage(cause)}`,
		cause,
	}),
	StartFailed: ({ cause }: { cause: unknown }) => ({
		message: `Unable to start recording: ${extractErrorMessage(cause)}`,
		cause,
	}),
	StopFailed: ({ cause }: { cause: unknown }) => ({
		message: `Failed to stop recording: ${extractErrorMessage(cause)}`,
		cause,
	}),
	CancelFailed: ({ cause }: { cause: unknown }) => ({
		message: `Failed to cancel recording: ${extractErrorMessage(cause)}`,
		cause,
	}),
	StreamAcquisition: ({ cause }: { cause: unknown }) => ({
		message: `Failed to acquire recording stream: ${extractErrorMessage(cause)}`,
		cause,
	}),
	GetStateFailed: ({ cause }: { cause: unknown }) => ({
		message: `Failed to get recorder state: ${extractErrorMessage(cause)}`,
		cause,
	}),
});
export type RecorderError = InferErrors<typeof RecorderError>;

/**
 * Settings-derived parameters shared across manual recorder implementations.
 *
 * This is config resolved from persisted settings (device, encoding). Live
 * caller callbacks are not config and travel separately in
 * {@link RecordingCallbacks}.
 */
type BaseRecordingParams = {
	selectedDeviceId: DeviceIdentifier | null;
	recordingId: string;
};

/**
 * Live callbacks supplied by the caller at the moment of starting, kept
 * separate from the settings-derived {@link CpalRecordingParams} /
 * {@link NavigatorRecordingParams} config because a callback is not a persisted
 * setting. They are passed alongside the resolved params, never merged into
 * them.
 */
export type RecordingCallbacks = {
	/**
	 * Sink for live mic loudness (raw RMS, ~0 silent to ~0.3 loud speech),
	 * called continuously while recording so the pill can draw a meter.
	 *
	 * The navigator recorder taps its MediaStream to drive this. The CPAL
	 * recorder reaches the same meter another way (Rust emits the level straight
	 * to the overlay window), so its `startRecording` simply does not accept
	 * callbacks.
	 */
	onLevel: (level: number) => void;
};

/**
 * CPAL (native Rust) recording parameters
 */
export type CpalRecordingParams = BaseRecordingParams & {
	sampleRate: string;
};

/**
 * Navigator (MediaRecorder) recording parameters
 */
export type NavigatorRecordingParams = BaseRecordingParams & {
	bitrateKbps: string;
};

// Imported from the tauri-specta boundary so `RecorderStopResult` is
// structurally identical to what `commands.stopRecording` returns. The Rust
// `RecordingArtifact` struct is the single source of truth; consumers that need
// the type import it from `$lib/tauri/commands` directly.
import type { RecordingArtifact } from '$lib/tauri/commands';

/**
 * Output of `RecordingSession.stop()`. One of two physical shapes:
 *
 * - `kind: 'artifact'`: cpal produced a durable WAV on disk; the handle
 *   is the canonical reference for transcribe/upload/delete. JS does not
 *   touch the bytes itself.
 * - `kind: 'blob'`: navigator (browser MediaRecorder) returned encoded
 *   container bytes (webm/opus, mp4/AAC) the JS side holds in memory.
 *   The pipeline persists it through the recordings blob store so the
 *   id-addressed Rust commands work on it too. There is intentionally
 *   no `Float32Array` arm: raw PCM never exists as a general front-end
 *   value.
 *
 * `durationMs` lives on whichever arm naturally carries it (the cpal
 * artifact stat, the navigator wall-clock measurement). VAD and file
 * uploads have no notion of duration at the recorder boundary; they
 * synthesize a `kind: 'blob'` result from outside the recorder and pass
 * `null` for duration at the pipeline boundary.
 */
export type RecorderStopResult =
	| { kind: 'artifact'; artifact: RecordingArtifact }
	| {
			kind: 'blob';
			blob: Blob;
			recordingId: string;
			durationMs: number | null;
	  };

/**
 * A live recording session returned by the recorder implementation that started it.
 *
 * The `RecordingSession` is the unit of lifecycle: it owns its own teardown and
 * exposes per-session state changes.
 *
 * The `subscribe` handler is invoked synchronously with the current state on
 * subscribe (so callers don't have to mirror "I just started" themselves),
 * then again whenever the session transitions, ending with 'IDLE' on
 * stop/cancel.
 */
export type RecordingSession = {
	readonly recordingId: string;
	stop(): Promise<Result<RecorderStopResult, RecorderError>>;
	/**
	 * Cancel the in-flight recording and discard it. Success carries no payload
	 * (a live session can only resolve to "cancelled"); the manual-recorder
	 * wrapper is where the `cancelled` vs `no-recording` distinction is made.
	 */
	cancel(): Promise<Result<void, RecorderError>>;
	subscribe(handler: (state: WhisperingRecordingState) => void): () => void;
};

/**
 * Factory for recording sessions. Services no longer carry mutable
 * start/stop state directly; instead `startRecording` returns a RecordingSession
 * whose methods are bound to the implementation that produced it.
 */
export type RecorderService<RecordingParams extends BaseRecordingParams> = {
	/**
	 * Recover a RecordingSession that may have survived a JS reload.
	 *
	 * CPAL sessions can outlive a JS reload because Rust keeps the stream;
	 * navigator sessions cannot survive a reload and return null.
	 *
	 * Returns the live RecordingSession owned by this implementation, or null if none.
	 */
	resumeActiveSession(): Promise<
		Result<RecordingSession | null, RecorderError>
	>;

	/**
	 * Enumerate available recording devices with their labels and identifiers
	 */
	enumerateDevices(): Promise<Result<Device[], RecorderError>>;

	/**
	 * Start a new recording session, returning the RecordingSession handle along
	 * with the device acquisition outcome. The caller holds the RecordingSession
	 * and uses its `stop`/`cancel`/`subscribe` for the rest of the session.
	 *
	 * `params` is settings-derived config; `callbacks` are the caller's live
	 * sinks. An implementation that satisfies the meter another way (CPAL via the
	 * overlay) may take only `params` and ignore the callbacks.
	 */
	startRecording(
		params: RecordingParams,
		callbacks: RecordingCallbacks,
	): Promise<
		Result<
			{
				session: RecordingSession;
				deviceAcquisition: DeviceAcquisitionOutcome;
			},
			RecorderError
		>
	>;
};
