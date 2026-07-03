import { goto } from '$app/navigation';
import { WHISPERING_RECORDINGS_PATHNAME } from '$lib/constants/urls';
import type { DeliveryOutcome } from '$lib/operations/delivery-reach';
import {
	clipboardSink,
	createCursorSink,
	ledgerSink,
	type Sink,
} from '$lib/operations/sink';
import type { Notice } from '$lib/report';
import { settings } from '$lib/state/settings.svelte';
import type { RecordingSink } from '$lib/workspace';

// The reach types live in their own `delivery-reach` module next to their ADR
// docstrings; re-exported here so callers keep one delivery import.
export type {
	DeliveryOutcome,
	DeliveryReach,
} from '$lib/operations/delivery-reach';

/**
 * The output scopes Whispering delivers into. Each has its own
 * clipboard/cursor/enter toggles under `output.<scope>.*`. Keeping the list in
 * one place lets delivery and the tap-hold capability derive from the same
 * source instead of hardcoding the scope names.
 */
const OUTPUT_SCOPES = ['transcription', 'recipe'] as const;
type OutputScope = (typeof OUTPUT_SCOPES)[number];

/**
 * True when any output scope is set to write at the cursor. Cursor delivery is a
 * synthetic Cmd/Ctrl+V, so this is exactly when delivery needs the macOS
 * Accessibility grant, which is the one fact the tap supervisor holds the tap to
 * track. Call inside a reactive scope to stay live as the toggles change.
 */
export function outputWritesToCursor(): boolean {
	return OUTPUT_SCOPES.some((scope) => settings.get(`output.${scope}.cursor`));
}

/**
 * Where a transcript originated: a live `recording` or an imported file
 * (`import`). Shapes the success copy and flows in from the pipeline's
 * `deliverySource`.
 */
export type TranscriptionSource = 'recording' | 'import';

const TRANSCRIPTION_SUCCESS_COPY = {
	recording: '📝 Recording transcribed',
	import: '📁 File transcribed',
} as const satisfies Record<TranscriptionSource, string>;

/**
 * A delivery result: the structured outcome, a human notice for toasts, and
 * the sink fact to persist on the recordings row (where the text actually
 * landed).
 */
export type DeliveryResult = {
	outcome: DeliveryOutcome;
	notice: Notice;
	sink: RecordingSink;
};

/**
 * Delivers transcript to the user according to their text output preferences
 * (copy to clipboard, write to cursor, simulate enter). Returns the structured
 * outcome plus a human notice; it does not toast. The dictation path reads the
 * outcome to drive the pill; file import and row actions show the notice.
 */
export async function deliverTranscriptionResult({
	text,
	source = 'recording',
}: {
	text: string;
	source?: TranscriptionSource;
}): Promise<DeliveryResult> {
	return deliverResult({
		text,
		successCopy: TRANSCRIPTION_SUCCESS_COPY[source],
		settingsScope: 'transcription',
		// A transcription always belongs to a recording, so its history is reachable.
		linkedRecording: true,
	});
}

/**
 * Delivers a Recipe's output to the user according to their text output
 * preferences. Returns the structured outcome plus a human notice. `recordingId`
 * is the run's link to a recording, or null for ad-hoc runs (clipboard,
 * selection): only a recording-anchored run offers a "go to recordings" action,
 * since an ad-hoc run has no history to open.
 */
export async function deliverRecipeResult({
	text,
	recordingId,
}: {
	text: string;
	recordingId: string | null;
}): Promise<DeliveryResult> {
	return deliverResult({
		text,
		successCopy: '🔄 Recipe complete',
		settingsScope: 'recipe',
		linkedRecording: recordingId !== null,
	});
}

async function deliverResult({
	text,
	successCopy,
	settingsScope,
	linkedRecording,
}: {
	text: string;
	successCopy: string;
	settingsScope: OutputScope;
	linkedRecording: boolean;
}): Promise<DeliveryResult> {
	const recordingsAction = linkedRecording
		? {
				label: 'Go to recordings',
				onClick: () => goto(WHISPERING_RECORDINGS_PATHNAME),
			}
		: undefined;

	// Resolve one sink from settings: cursor beats clipboard beats the ledger.
	// Nothing configured still reaches history, since the recordings row is
	// itself the destination (ledgerSink).
	const cursorRequested = settings.get(`output.${settingsScope}.cursor`);
	const clipboardRequested = settings.get(`output.${settingsScope}.clipboard`);
	const sink: Sink = cursorRequested
		? createCursorSink({
				keepOnClipboard: clipboardRequested,
				pressEnter: settings.get(`output.${settingsScope}.enter`),
			})
		: clipboardRequested
			? clipboardSink
			: ledgerSink;

	const reach = await sink.deliver(text);

	// The fact recorded on the row: a cursor sink that could not paste
	// downgrades to a `clipboard` fact, since that is where the text actually
	// landed. Every other sink's fact is just its own kind. `ref` is always
	// null: nothing produces one yet.
	const sinkFact: RecordingSink = {
		kind:
			sink.kind === 'cursor' && reach === 'clipboard' ? 'clipboard' : sink.kind,
		ref: null,
	};

	const title =
		sink.kind === 'cursor'
			? reach === 'output'
				? `${successCopy} and written to cursor!`
				: `${successCopy}, copied to clipboard (couldn't write to cursor)`
			: `${successCopy}!`;

	return {
		outcome: { reach },
		sink: sinkFact,
		notice: { title, description: text, action: recordingsAction },
	};
}
