import type { QueryClient } from '@tanstack/svelte-query';
import type { MessageSummary } from './types';

/** Shared key for label/trash/read/star writes. Projection optimism reads
 * pending mutations under this key and overlays their label deltas at render
 * time; the TanStack query cache remains confirmed server truth. */
export const MESSAGE_WRITE_MUTATION_KEY = [
	'local-mail',
	'message-write',
] as const;

/** The label add/remove a write predicts while Gmail is still authoritative. */
export type LabelDelta = { add: string[]; remove: string[] };

/** One pending message write projected over cached rows. Every message-write
 * mutation's variables carry these two fields, so its variables are a superset
 * of this type. */
export type PendingMessageWrite = { id: string; delta: LabelDelta };

/** Trash/untrash as a label delta. `messages.trash` adds `TRASH`; untrash
 * removes it, matching how the mirror stores trash. */
export function deltaForTrashed(trashed: boolean): LabelDelta {
	return trashed
		? { add: ['TRASH'], remove: [] }
		: { add: [], remove: ['TRASH'] };
}

/** Apply one label delta the way Gmail's fold will: drop removed ids, append
 * added ids that are not already present, and preserve survivor order. */
export function applyLabelDelta(
	labelIds: string[],
	delta: LabelDelta,
): string[] {
	const removed = new Set(delta.remove);
	const next = labelIds.filter((id) => !removed.has(id));
	for (const id of delta.add) if (!next.includes(id)) next.push(id);
	return next;
}

/** Apply several pending deltas in mutation order, for rapid keyboard writes
 * against the same id. */
export function applyLabelDeltas(
	labelIds: string[],
	deltas: LabelDelta[],
): string[] {
	return deltas.reduce(applyLabelDelta, labelIds);
}

/**
 * Whether a row with these labels belongs in a list filtered by `queryLabel`
 * (`null` = the all-mail view, matching the page's selection state). This
 * mirrors the one read-model rule optimism is allowed to reproduce: a label
 * filter requires that label, and `TRASH` is hidden from every view except
 * Trash. Search, counts, and ordering stay owned by the reconciling refetch.
 */
export function rowMatchesLabelFilter(
	labelIds: string[],
	queryLabel: string | null,
): boolean {
	if (queryLabel && !labelIds.includes(queryLabel)) return false;
	if (queryLabel !== 'TRASH' && labelIds.includes('TRASH')) return false;
	return true;
}

/** Project cached rows through pending write deltas. Rows already in the cache
 * may update or disappear from the current label view, but absent rows are never
 * invented into other filtered lists. */
export function projectMessageList(
	messages: MessageSummary[],
	pendingWrites: PendingMessageWrite[],
	queryLabel: string | null,
): MessageSummary[] {
	return messages
		.map((message) => {
			const deltas = pendingWrites
				.filter((write) => write.id === message.id)
				.map((write) => write.delta);
			if (deltas.length === 0) return message;
			return {
				...message,
				labelIds: applyLabelDeltas(message.labelIds, deltas),
			};
		})
		.filter((message) => rowMatchesLabelFilter(message.labelIds, queryLabel));
}

// --- TanStack seam ---------------------------------------------------------
// The rest of this module is pure algebra; the two functions below are the only
// part that touches TanStack. They live here, beside the projection they feed
// and out of the Svelte component, so the mutation-cache read and the settle
// reconcile are both unit-testable against a real QueryClient.

/**
 * The pending message writes to project, read straight from TanStack's mutation
 * cache. The pending mutation *is* the write intent, so there is no second
 * store to keep in sync. The mutation key guarantees every match is a
 * `modify`/`setTrashed` write whose variables extend `PendingMessageWrite`, so
 * the cast is honest: `state.variables` is `unknown` only because the cache is
 * shared across mutation shapes.
 *
 * Read by hand rather than via `useMutationState`: that helper (svelte-query
 * 6.x) updates its result with `Object.assign`, which never shrinks the array,
 * so a settled write would keep masking its row. Callers mirror this into a
 * `$state.raw` cell that is replaced wholesale on every mutation-cache change.
 */
export function readPendingWrites(
	queryClient: QueryClient,
): PendingMessageWrite[] {
	return queryClient
		.getMutationCache()
		.findAll({ mutationKey: MESSAGE_WRITE_MUTATION_KEY, status: 'pending' })
		.map((mutation) => mutation.state.variables as PendingMessageWrite);
}

/**
 * Reconcile confirmed truth after a write, and crucially do not resolve until
 * the messages refetch has landed. A mutation awaits its `onSettled`, so
 * returning this promise there keeps the write `pending` (and its delta
 * projected) across the refetch: the delta stops masking the row only once the
 * cache already holds post-write truth, so the row cannot flash back from the
 * stale pre-write cache.
 */
export async function reconcileAfterWrite(
	queryClient: QueryClient,
	id: string,
): Promise<void> {
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: ['messages'] }),
		queryClient.invalidateQueries({ queryKey: ['status'] }),
		queryClient.invalidateQueries({ queryKey: ['message', id] }),
	]);
}
