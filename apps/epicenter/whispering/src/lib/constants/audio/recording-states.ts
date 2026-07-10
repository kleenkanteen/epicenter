/**
 * Recording state types. These are plain unions: the states are never validated
 * at runtime, only used as compile-time types.
 */

// The recorder lifecycle state lives on Whispering's recorder contract; alias
// it to the app's existing name so in-app consumers keep their import.
export type { RecordingState as WhisperingRecordingState } from '$lib/services/recorder/contract';

/**
 * VAD session state as the UI tracks it: closed, armed and waiting for speech,
 * or mid-utterance. Mirrored from the package's speech callbacks by
 * `vad-recorder.svelte.ts`.
 */
export type VadState = 'IDLE' | 'LISTENING' | 'SPEECH_DETECTED';
