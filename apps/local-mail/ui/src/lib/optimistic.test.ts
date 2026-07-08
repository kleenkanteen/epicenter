/**
 * Local Mail Optimistic Projection Tests
 *
 * Verifies the temporary label-delta projection used while Gmail writes are
 * pending. The TanStack Query cache stays confirmed truth; these tests prove the
 * render-time overlay hides or patches only rows that are already cached.
 *
 * Key behaviors:
 * - Label deltas compose in pending mutation order
 * - Projected lists patch or drop cached rows without inventing absent rows
 */
import { describe, expect, test } from 'bun:test';
import {
	applyLabelDelta,
	applyLabelDeltas,
	deltaForTrashed,
	projectMessageList,
	rowMatchesLabelFilter,
} from './optimistic';
import type { MessageSummary } from './types';

function summary(id: string, labelIds: string[]): MessageSummary {
	return {
		id,
		threadId: id,
		subject: `subject ${id}`,
		sender: `sender ${id}`,
		snippet: null,
		internalDate: 0,
		labelIds,
	};
}

describe('applyLabelDelta', () => {
	test('removes, adds, and dedupes while preserving order', () => {
		expect(applyLabelDelta(['INBOX', 'UNREAD'], { add: [], remove: ['UNREAD'] })).toEqual(
			['INBOX'],
		);
		expect(applyLabelDelta(['INBOX'], { add: ['STARRED'], remove: [] })).toEqual([
			'INBOX',
			'STARRED',
		]);
		expect(applyLabelDelta(['INBOX'], { add: ['INBOX'], remove: [] })).toEqual([
			'INBOX',
		]);
	});

	test('trash desugars to adding TRASH, untrash to removing it', () => {
		expect(applyLabelDelta(['INBOX'], deltaForTrashed(true))).toEqual([
			'INBOX',
			'TRASH',
		]);
		expect(applyLabelDelta(['INBOX', 'TRASH'], deltaForTrashed(false))).toEqual([
			'INBOX',
		]);
	});

	test('multiple deltas compose in order for the same pending row', () => {
		expect(
			applyLabelDeltas(['INBOX', 'UNREAD'], [
				{ add: [], remove: ['INBOX'] },
				{ add: ['STARRED'], remove: [] },
			]),
		).toEqual(['UNREAD', 'STARRED']);
	});
});

describe('rowMatchesLabelFilter', () => {
	test('a label filter keeps only rows carrying that label', () => {
		expect(rowMatchesLabelFilter(['INBOX'], 'INBOX')).toBe(true);
		expect(rowMatchesLabelFilter(['STARRED'], 'INBOX')).toBe(false);
	});

	test('TRASH is hidden from every view but the TRASH view', () => {
		expect(rowMatchesLabelFilter(['INBOX', 'TRASH'], 'INBOX')).toBe(false);
		expect(rowMatchesLabelFilter(['INBOX', 'TRASH'], undefined)).toBe(false);
		expect(rowMatchesLabelFilter(['INBOX', 'TRASH'], 'TRASH')).toBe(true);
	});

	test('the all/any view keeps any non-trashed row', () => {
		expect(rowMatchesLabelFilter(['STARRED'], undefined)).toBe(true);
	});
});

describe('projectMessageList', () => {
	test('patches a cached row in place when it still matches the filter', () => {
		const rows = [summary('a', ['INBOX', 'UNREAD']), summary('b', ['INBOX'])];

		const projected = projectMessageList(
			rows,
			[{ id: 'a', delta: { add: ['STARRED'], remove: [] } }],
			'INBOX',
		);

		expect(projected.map((m) => m.id)).toEqual(['a', 'b']);
		expect(projected[0]?.labelIds).toEqual(['INBOX', 'UNREAD', 'STARRED']);
		expect(rows[0]?.labelIds).toEqual(['INBOX', 'UNREAD']);
	});

	test('drops a cached row when pending labels remove it from the current view', () => {
		const projected = projectMessageList(
			[summary('a', ['INBOX']), summary('b', ['INBOX'])],
			[{ id: 'a', delta: { add: [], remove: ['INBOX'] } }],
			'INBOX',
		);

		expect(projected.map((m) => m.id)).toEqual(['b']);
	});

	test('trashing hides a cached row from non-trash views immediately', () => {
		const projected = projectMessageList(
			[summary('a', ['INBOX']), summary('b', ['INBOX'])],
			[{ id: 'a', delta: deltaForTrashed(true) }],
			'INBOX',
		);

		expect(projected.map((m) => m.id)).toEqual(['b']);
	});

	test('a failed trash naturally returns when the pending delta disappears', () => {
		const rows = [summary('a', ['INBOX']), summary('b', ['INBOX'])];

		expect(
			projectMessageList(rows, [{ id: 'a', delta: deltaForTrashed(true) }], 'INBOX').map(
				(m) => m.id,
			),
		).toEqual(['b']);
		expect(projectMessageList(rows, [], 'INBOX').map((m) => m.id)).toEqual([
			'a',
			'b',
		]);
	});

	test('does not invent an absent row into a list', () => {
		const projected = projectMessageList(
			[summary('b', ['INBOX'])],
			[{ id: 'a', delta: { add: ['INBOX'], remove: [] } }],
			'INBOX',
		);

		expect(projected.map((m) => m.id)).toEqual(['b']);
	});

	test('applies multiple pending writes for the same cached row', () => {
		const projected = projectMessageList(
			[summary('a', ['INBOX', 'UNREAD'])],
			[
				{ id: 'a', delta: { add: [], remove: ['INBOX'] } },
				{ id: 'a', delta: { add: ['STARRED'], remove: [] } },
			],
			undefined,
		);

		expect(projected[0]?.labelIds).toEqual(['UNREAD', 'STARRED']);
	});
});
