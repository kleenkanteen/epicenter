/**
 * Local Mail Optimistic Projection Tests
 *
 * Verifies the temporary label-delta projection used while Gmail writes are
 * pending. The TanStack Query cache stays confirmed truth; these tests prove the
 * render-time overlay hides or patches only rows that are already cached.
 *
 * Two layers:
 * - The pure projection algebra (label deltas compose in mutation order; lists
 *   patch or drop cached rows without inventing absent rows).
 * - The TanStack seam, exercised against a real QueryClient: a pending write is
 *   read from the mutation cache and drops when it settles, concurrent writes
 *   mask only their own id, and `reconcileAfterWrite` keeps a write pending
 *   until the messages refetch lands, so a settled write cannot flash back.
 */
import {
	MutationObserver,
	QueryClient,
	QueryObserver,
} from '@tanstack/svelte-query';
import { describe, expect, test } from 'bun:test';
import {
	applyLabelDelta,
	applyLabelDeltas,
	deltaForTrashed,
	type LabelDelta,
	MESSAGE_WRITE_MUTATION_KEY,
	projectMessageList,
	readPendingWrites,
	reconcileAfterWrite,
	rowMatchesLabelFilter,
} from './optimistic';
import type { MessageSummary } from './types';

/** Yield a macrotask so a scheduled mutation/refetch can advance. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Fire a message-write mutation that hangs until the returned function is
 * called, so a test can observe the pending window and then settle it. Mirrors
 * how `+page.svelte` shapes its `modify`/`setTrashed` variables.
 */
function startPendingWrite(
	client: QueryClient,
	write: { id: string; delta: LabelDelta },
): () => void {
	let release: (() => void) | undefined;
	const observer = new MutationObserver(client, {
		mutationKey: MESSAGE_WRITE_MUTATION_KEY,
		mutationFn: (_write: { id: string; delta: LabelDelta }) =>
			new Promise<void>((resolve) => (release = resolve)),
	});
	void observer.mutate(write);
	return () => release?.();
}

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
		expect(rowMatchesLabelFilter(['INBOX', 'TRASH'], null)).toBe(false);
		expect(rowMatchesLabelFilter(['INBOX', 'TRASH'], 'TRASH')).toBe(true);
	});

	test('the all-mail view keeps any non-trashed row', () => {
		expect(rowMatchesLabelFilter(['STARRED'], null)).toBe(true);
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
			null,
		);

		expect(projected[0]?.labelIds).toEqual(['UNREAD', 'STARRED']);
	});
});

describe('readPendingWrites', () => {
	test('surfaces a pending write and drops it once settled', async () => {
		const client = new QueryClient();

		const release = startPendingWrite(client, {
			id: 'a',
			delta: deltaForTrashed(true),
		});
		await tick();
		expect(readPendingWrites(client)).toEqual([
			{ id: 'a', delta: { add: ['TRASH'], remove: [] } },
		]);

		release();
		await tick();
		expect(readPendingWrites(client)).toEqual([]);
	});

	test('ignores mutations under a different key', async () => {
		const client = new QueryClient();
		const observer = new MutationObserver(client, {
			mutationKey: ['some-other-write'],
			mutationFn: (_write: { id: string; delta: LabelDelta }) =>
				new Promise<void>(() => {}),
		});
		void observer.mutate({ id: 'a', delta: deltaForTrashed(true) });
		await tick();

		expect(readPendingWrites(client)).toEqual([]);
	});
});

describe('projection over the live mutation cache', () => {
	test('a pending trash hides the row; settling the write returns it from the unchanged cache', async () => {
		const client = new QueryClient();
		const rows = [summary('a', ['INBOX']), summary('b', ['INBOX'])];

		const release = startPendingWrite(client, {
			id: 'a',
			delta: deltaForTrashed(true),
		});
		await tick();
		expect(
			projectMessageList(rows, readPendingWrites(client), 'INBOX').map(
				(m) => m.id,
			),
		).toEqual(['b']);

		// A rejected/failed write never touches the cache, so when its delta drops
		// the row simply returns from the untouched confirmed rows.
		release();
		await tick();
		expect(
			projectMessageList(rows, readPendingWrites(client), 'INBOX').map(
				(m) => m.id,
			),
		).toEqual(['a', 'b']);
	});

	test('concurrent writes mask only their own id, and settling one does not resurrect the other', async () => {
		const client = new QueryClient();
		const rows = [
			summary('a', ['INBOX']),
			summary('b', ['INBOX']),
			summary('c', ['INBOX']),
		];

		const releaseA = startPendingWrite(client, {
			id: 'a',
			delta: deltaForTrashed(true),
		});
		const releaseB = startPendingWrite(client, {
			id: 'b',
			delta: deltaForTrashed(true),
		});
		await tick();
		expect(
			projectMessageList(rows, readPendingWrites(client), 'INBOX').map(
				(m) => m.id,
			),
		).toEqual(['c']);

		releaseA();
		await tick();
		expect(
			projectMessageList(rows, readPendingWrites(client), 'INBOX').map(
				(m) => m.id,
			),
		).toEqual(['a', 'c']);

		releaseB();
		await tick();
	});
});

describe('reconcileAfterWrite', () => {
	test('does not resolve until the messages refetch lands', async () => {
		const client = new QueryClient();
		const listKey = ['messages', { label: 'INBOX' }];
		// Confirmed truth starts with the row present; prime it fresh so the
		// observer does not fetch on mount and only the reconcile refetch runs.
		client.setQueryData(listKey, { messages: [summary('a', ['INBOX'])] });

		let releaseRefetch: (() => void) | undefined;
		let refetchStarted = false;
		const observer = new QueryObserver(client, {
			queryKey: listKey,
			staleTime: Number.POSITIVE_INFINITY,
			queryFn: async () => {
				refetchStarted = true;
				await new Promise<void>((resolve) => (releaseRefetch = resolve));
				return { messages: [] as MessageSummary[] };
			},
		});
		const unsubscribe = observer.subscribe(() => {});

		let reconciled = false;
		const settle = reconcileAfterWrite(client, 'a').then(() => {
			reconciled = true;
		});

		// The invalidation has started the refetch, but it has not landed, so the
		// reconcile (and thus the mutation's pending state) is still open and the
		// cache still holds the pre-write row.
		await tick();
		await tick();
		expect(refetchStarted).toBe(true);
		expect(reconciled).toBe(false);
		expect(
			(client.getQueryData(listKey) as { messages: MessageSummary[] }).messages,
		).toHaveLength(1);

		releaseRefetch?.();
		await settle;
		expect(reconciled).toBe(true);
		expect(
			(client.getQueryData(listKey) as { messages: MessageSummary[] }).messages,
		).toHaveLength(0);

		unsubscribe();
	});
});
