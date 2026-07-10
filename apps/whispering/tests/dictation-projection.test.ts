import { describe, expect, test } from 'bun:test';
import { projectLifecycleToStatus } from '../src/lib/recording-overlay/projection';
import type {
	DictationCapture,
	DictationFailure,
	DictationOutcome,
} from '../src/lib/state/dictation-lifecycle.svelte';

/**
 * Locks the dictation pill's projection invariants (ADR-0039). The projection is
 * the one place capture and outcome are flattened into the serializable status
 * both pill mounts render, so a regression here silently changes desktop and web
 * at once. These cases pin the subtle rules: a live VAD meter is never replaced,
 * a previous utterance still transcribing flags the `transcribing` signal beside
 * it, and neither success nor failure flags it (success is the landing text;
 * failure goes to the notification and the recordings row).
 *
 * The lifecycle types are structural, so the inputs are plain objects (the
 * `import type` in the projection erases at runtime, leaving a pure function).
 */
const idle = { kind: 'idle' } satisfies DictationCapture;
const manual = {
	kind: 'recording',
	trigger: 'manual',
} satisfies DictationCapture;
const vad = (vadState: 'LISTENING' | 'SPEECH_DETECTED') =>
	({ kind: 'recording', trigger: 'vad', vadState }) satisfies DictationCapture;
const failure = {
	tier: 'transcription',
	error: { name: 'TestError', message: 'boom' },
} satisfies DictationFailure;

const project = (capture: DictationCapture, outcome: DictationOutcome) =>
	projectLifecycleToStatus({ capture, outcome });

describe('dictation pill projection', () => {
	test('idle capture with no outcome hides the pill', () => {
		expect(project(idle, { kind: 'none' })).toBeNull();
	});

	test('manual capture projects a plain recording pill', () => {
		expect(project(manual, { kind: 'none' })).toEqual({
			phase: 'recording',
			trigger: 'manual',
		});
	});

	test('VAD listening at rest shows the meter, not speaking, not transcribing', () => {
		expect(project(vad('LISTENING'), { kind: 'none' })).toEqual({
			phase: 'recording',
			trigger: 'vad',
			isSpeaking: false,
			isTranscribing: false,
		});
	});

	test('VAD keeps the meter and flags a previous phrase still transcribing', () => {
		expect(project(vad('LISTENING'), { kind: 'transcribing' })).toEqual({
			phase: 'recording',
			trigger: 'vad',
			isSpeaking: false,
			isTranscribing: true,
		});
	});

	test('VAD speech latches the speaking signal', () => {
		expect(project(vad('SPEECH_DETECTED'), { kind: 'none' })).toEqual({
			phase: 'recording',
			trigger: 'vad',
			isSpeaking: true,
			isTranscribing: false,
		});
	});

	test('a VAD failure does not show on the pill: meter only, not transcribing', () => {
		expect(
			project(vad('SPEECH_DETECTED'), { kind: 'failed', ...failure }),
		).toEqual({
			phase: 'recording',
			trigger: 'vad',
			isSpeaking: true,
			isTranscribing: false,
		});
	});

	test('a VAD success earns no transcribing signal', () => {
		expect(
			project(vad('LISTENING'), { kind: 'delivered', reach: 'output' }),
		).toEqual({
			phase: 'recording',
			trigger: 'vad',
			isSpeaking: false,
			isTranscribing: false,
		});
	});

	test('idle capture projects the outcome as the primary pill', () => {
		expect(project(idle, { kind: 'transcribing' })).toEqual({
			phase: 'transcribing',
		});
		expect(project(idle, { kind: 'delivered', reach: 'clipboard' })).toEqual({
			phase: 'delivered',
			reach: 'clipboard',
		});
		// The failure projects only its tier; the live error (and its message) is
		// dropped at the seam, mapped to a terse label by the pill.
		expect(project(idle, { kind: 'failed', ...failure })).toEqual({
			phase: 'failed',
			tier: 'transcription',
		});
	});
});
