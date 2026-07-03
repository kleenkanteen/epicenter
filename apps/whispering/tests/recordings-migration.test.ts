/**
 * Phase 0 migration gate for `recordings` v1 -> v2 (see
 * specs/20260628T003033-voice-cursor-intent-in-context.md). The load-bearing
 * criterion: every pre-upgrade row must still appear in history after the
 * schema grows `raw`/`result`/`intent`/`operand`/`sink`.
 *
 * The v1 table here is a literal copy of the pre-v2 `recordings` columns
 * (never edit it: it pins the shape every legacy row is stamped `_v: 1`
 * against). Rows are written through it (a real `createWorkspace`, so `_v` is
 * stamped the same way production stamps it), the resulting Yjs update is
 * replayed onto a second workspace built from the REAL exported `recordings`
 * table (`$lib/workspace/recordings`, re-exported by `$lib/workspace`), and
 * reads happen through that real definition, exercising its actual `migrate`
 * step end to end.
 *
 * `recordings` lives in its own leaf module specifically so this works: the
 * app-wide `$lib/workspace/definition` pulls in several `$lib/*` settings
 * modules that `bun test` cannot resolve (no SvelteKit `$lib` alias outside
 * Vite), so importing it directly here would fail before a single row is
 * written. `createTable`/`attachTable` are package-internal (public callers go
 * through `createWorkspace`), so transplanting a Yjs update between two
 * `createWorkspace` instances is the least-internal seam available from
 * app-land.
 */
import { describe, expect, test } from 'bun:test';
import { field, InstantString } from '@epicenter/field';
import {
	createWorkspace,
	defineTable,
	IanaTimeZone,
	nullable,
} from '@epicenter/workspace';
import { Type } from 'typebox';
import * as Y from 'yjs';
import { recordings } from '../src/lib/workspace/recordings';

// The pre-v2 `transcription` outcome shape, inlined so this legacy table has
// no dependency on the real (post-v2) definition module.
const LegacyTranscriptionOutcome = Type.Union([
	Type.Object({
		status: Type.Literal('completed'),
		completedAt: field.instant(),
	}),
	Type.Object({
		status: Type.Literal('failed'),
		completedAt: field.instant(),
		error: Type.String(),
	}),
]);

// v1: the pre-intent shape. A literal copy of the old single-version
// `recordings` columns; never edit it to match the real definition, since it
// exists to pin what a legacy row looked like.
const legacyRecordings = defineTable({
	id: field.string(),
	title: field.string(),
	recordedAt: field.instant(),
	recordedAtZone: field.string<IanaTimeZone>(),
	transcript: field.string(),
	polishedTranscript: nullable(field.string()),
	duration: nullable(field.number()),
	transcription: nullable(field.json(LegacyTranscriptionOutcome)),
});

const WORKSPACE_ID = 'whispering-recordings-migration-test';

const recordedAt = InstantString.now();
const recordedAtZone = IanaTimeZone.current();

const legacyRowWithPolish = {
	id: 'rec-polished',
	title: 'Meeting notes',
	recordedAt,
	recordedAtZone,
	transcript: 'this is what i said',
	polishedTranscript: 'This is what I said.',
	duration: 12.5,
	transcription: { status: 'completed' as const, completedAt: recordedAt },
};

const legacyRowSpeedMode = {
	id: 'rec-speed-mode',
	title: '',
	recordedAt,
	recordedAtZone,
	transcript: 'raw only, never polished',
	polishedTranscript: null,
	duration: null,
	transcription: null,
};

/**
 * Write both legacy rows through a v1-only workspace, then hand back the Yjs
 * update so it can be replayed onto a workspace built from the real v2
 * definition. This is what stamps every row `_v: 1`.
 */
function encodeLegacyRows() {
	const legacyWorkspace = createWorkspace({
		id: WORKSPACE_ID,
		tables: { recordings: legacyRecordings },
		kv: {},
	});
	legacyWorkspace.tables.recordings.set(legacyRowWithPolish);
	legacyWorkspace.tables.recordings.set(legacyRowSpeedMode);
	return Y.encodeStateAsUpdate(legacyWorkspace.ydoc);
}

/** Build a fresh workspace over the REAL v2 `recordings` definition. */
function createRealWorkspace() {
	return createWorkspace({
		id: WORKSPACE_ID,
		tables: { recordings },
		kv: {},
	});
}

describe('recordings v1 -> v2 migration', () => {
	test('every legacy row survives: scan().nonconforming is empty, scan().rows has both', () => {
		const update = encodeLegacyRows();
		const workspace = createRealWorkspace();
		Y.applyUpdate(workspace.ydoc, update);

		const scan = workspace.tables.recordings.scan();
		expect(scan.nonconforming).toHaveLength(0);
		expect(scan.rows).toHaveLength(2);
	});

	test('a legacy row with a polished result migrates raw/result/intent/operand/sink', () => {
		const update = encodeLegacyRows();
		const workspace = createRealWorkspace();
		Y.applyUpdate(workspace.ydoc, update);

		const { rows } = workspace.tables.recordings.scan();
		const migrated = rows.find((row) => row.id === 'rec-polished');
		expect(migrated).toEqual({
			id: 'rec-polished',
			title: 'Meeting notes',
			recordedAt,
			recordedAtZone,
			raw: 'this is what i said',
			result: 'This is what I said.',
			intent: 'dictate',
			operand: { kind: 'none', text: null },
			sink: null,
			duration: 12.5,
			transcription: { status: 'completed', completedAt: recordedAt },
		});
	});

	test('a legacy row with no polish pass (speed mode) migrates with result null', () => {
		const update = encodeLegacyRows();
		const workspace = createRealWorkspace();
		Y.applyUpdate(workspace.ydoc, update);

		const { rows } = workspace.tables.recordings.scan();
		const migrated = rows.find((row) => row.id === 'rec-speed-mode');
		expect(migrated).toEqual({
			id: 'rec-speed-mode',
			title: '',
			recordedAt,
			recordedAtZone,
			raw: 'raw only, never polished',
			result: null,
			intent: 'dictate',
			operand: { kind: 'none', text: null },
			sink: null,
			duration: null,
			transcription: null,
		});
	});

	test('get(id) returns the migrated shape', () => {
		const update = encodeLegacyRows();
		const workspace = createRealWorkspace();
		Y.applyUpdate(workspace.ydoc, update);

		const { data, error } = workspace.tables.recordings.get('rec-polished');
		expect(error).toBeNull();
		expect(data?.raw).toBe('this is what i said');
		expect(data?.result).toBe('This is what I said.');
		expect(data?.sink).toBeNull();
	});

	test('a new row written through the v2 API roundtrips with intent/operand/sink intact', () => {
		const workspace = createRealWorkspace();
		workspace.tables.recordings.set({
			id: 'rec-new',
			title: 'New capture',
			recordedAt,
			recordedAtZone,
			raw: 'brand new words',
			result: null,
			intent: 'dictate',
			operand: { kind: 'none', text: null },
			sink: { kind: 'clipboard', ref: null },
			duration: 3,
			transcription: null,
		});

		const { data, error } = workspace.tables.recordings.get('rec-new');
		expect(error).toBeNull();
		expect(data).toEqual({
			id: 'rec-new',
			title: 'New capture',
			recordedAt,
			recordedAtZone,
			raw: 'brand new words',
			result: null,
			intent: 'dictate',
			operand: { kind: 'none', text: null },
			sink: { kind: 'clipboard', ref: null },
			duration: 3,
			transcription: null,
		});
	});
});
