/**
 * The `recordings` table definition, kept in its own leaf module (no `$lib/*`
 * imports) so it loads standalone under `bun test`: the migration test
 * (`tests/recordings-migration.test.ts`) attaches this exact export to a
 * transplanted Yjs update, and that only works if importing it does not also
 * drag in the rest of `definition.ts`'s app-wide `$lib` settings imports.
 */
import { field } from '@epicenter/field';
import {
	defineTable,
	type IanaTimeZone,
	type InferTableRow,
	nullable,
} from '@epicenter/workspace';
import { type Static, type TProperties, Type } from 'typebox';

/**
 * A terminal job outcome: `completed` or `failed`. Both variants carry the
 * finish instant; `failed` adds the error message; `completed` carries whatever
 * job-specific payload the caller declares through `completedExtra`.
 *
 * Only terminal states are ever stored. A job still in flight has no outcome
 * (the storing column is null); liveness comes from the in-flight mutation,
 * never from durable state. A stored 'running'/'transcribing' status would
 * wedge on crash: the process that died can no longer write the terminal
 * state. See
 * docs/articles/20260612T190745-liveness-belongs-to-the-process-not-the-row.md.
 */
function terminalOutcome<CompletedExtra extends TProperties>(
	completedExtra: CompletedExtra,
) {
	return Type.Union([
		Type.Object({
			status: Type.Literal('completed'),
			completedAt: field.instant(),
			...completedExtra,
		}),
		Type.Object({
			status: Type.Literal('failed'),
			completedAt: field.instant(),
			error: Type.String(),
		}),
	]);
}

/**
 * Terminal outcome of transcribing a recording. The transcript text lives in
 * its own `raw` column, so the `completed` variant only records when it
 * finished.
 */
const TranscriptionOutcome = terminalOutcome({});

/**
 * What a capture acted on. Every capture today is `{ kind: 'none', text: null
 * }`: no gesture yet supplies a selection or clipboard operand (that is
 * Phase 2). The shape exists now so the v2 row does not need a second
 * migration once it does.
 */
const OperandSchema = Type.Object({
	kind: Type.Union([
		Type.Literal('none'),
		Type.Literal('selection'),
		Type.Literal('clipboard'),
	]),
	text: nullable(Type.String()),
});

/**
 * Where a capture's text can land. `cursor`/`clipboard`/`replace-selection`
 * are real destinations; `ledger` means nothing external was configured, so
 * the recordings row itself is the destination.
 */
const SinkSchema = Type.Object({
	kind: Type.Union([
		Type.Literal('cursor'),
		Type.Literal('clipboard'),
		Type.Literal('replace-selection'),
		Type.Literal('ledger'),
	]),
	ref: nullable(Type.String()),
});

/**
 * A capture's delivery fact: where the text actually landed. A terminal fact
 * like `transcription`, only ever written after delivery happened; `null`
 * until then. `ref` is always `null` today; nothing produces one yet.
 */
export type RecordingSink = Static<typeof SinkSchema>;

/** The sink vocabulary on its own, for code that names a destination. */
export type SinkKind = RecordingSink['kind'];

/**
 * Audio recordings captured by the user. One row per recording session.
 *
 * `transcription` holds only the terminal outcome (completed or failed). A
 * recording that is currently transcribing has no `transcription`; liveness is
 * derived from the in-flight mutation, never stored.
 *
 * v2 generalizes the row from "a transcript dropped at the cursor" to "an
 * intent applied to a context" (see the voice-cursor-intent spec):
 * - `raw`: exactly what the transcriber heard (was `transcript`).
 * - `result`: what an AI pass produced and delivered. Null in speed mode and
 *   on a polish-failure fallback, where no result exists (was
 *   `polishedTranscript`).
 * - `intent`: which gesture made the capture. Only `'dictate'` has a producer
 *   today; `'instruct'` lands in Phase 2.
 * - `operand`: what the capture acted on. Always `{ kind: 'none', text: null
 *   }` today.
 * - `sink`: the terminal delivery fact, `null` until delivered (or when
 *   delivery never happened), same stance as `transcription`.
 *
 * Legacy rows migrate with `sink: null`, not `'cursor'`: most pre-v2 rows were
 * clipboard-delivered, so stamping `'cursor'` would fabricate a fact this
 * binary never observed.
 */
export const recordings = defineTable(
	// v1: the pre-intent shape; every legacy row is stamped _v: 1 and must keep
	// validating against this exact copy, so never edit it.
	{
		id: field.string(),
		title: field.string(),
		recordedAt: field.instant(),
		recordedAtZone: field.string<IanaTimeZone>(),
		transcript: field.string(),
		polishedTranscript: nullable(field.string()),
		duration: nullable(field.number()),
		transcription: nullable(field.json(TranscriptionOutcome)),
	},
	// v2: the generalized capture record (raw/result/intent/operand/sink).
	{
		id: field.string(),
		title: field.string(),
		recordedAt: field.instant(),
		recordedAtZone: field.string<IanaTimeZone>(),
		raw: field.string(),
		result: nullable(field.string()),
		intent: field.select(['dictate', 'instruct']),
		operand: field.json(OperandSchema),
		sink: nullable(field.json(SinkSchema)),
		duration: nullable(field.number()),
		transcription: nullable(field.json(TranscriptionOutcome)),
	},
).migrate(({ value, version }) => {
	switch (version) {
		case 1: {
			const { transcript, polishedTranscript, ...rest } = value;
			return {
				...rest,
				raw: transcript,
				result: polishedTranscript,
				intent: 'dictate',
				operand: { kind: 'none', text: null },
				sink: null,
			};
		}
		case 2:
			return value;
	}
});

/** Recording row type inferred from the workspace table schema. */
export type Recording = InferTableRow<typeof recordings>;
