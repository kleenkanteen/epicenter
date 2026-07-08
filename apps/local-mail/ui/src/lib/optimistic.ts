import type { MessageSummary } from './types';

/** Shared key for label/trash/read/star writes. Projection optimism reads
 * pending mutations under this key and overlays their label deltas at render
 * time; the TanStack query cache remains confirmed server truth. */
export const MESSAGE_WRITE_MUTATION_KEY = ['local-mail', 'message-write'] as const;

/** The label add/remove a write predicts while Gmail is still authoritative. */
export type LabelDelta = { add: string[]; remove: string[] };

/** One pending message write projected over cached rows. Every message-write
 * mutation's variables carry these two fields, so its variables are a superset
 * of this type. */
export type PendingMessageWrite = { id: string; delta: LabelDelta };

/** Trash/untrash as a label delta. `messages.trash` adds `TRASH`; untrash
 * removes it, matching how the mirror stores trash. */
export function deltaForTrashed(trashed: boolean): LabelDelta {
	return trashed ? { add: ['TRASH'], remove: [] } : { add: [], remove: ['TRASH'] };
}

/** Apply one label delta the way Gmail's fold will: drop removed ids, append
 * added ids that are not already present, and preserve survivor order. */
export function applyLabelDelta(labelIds: string[], delta: LabelDelta): string[] {
	const removed = new Set(delta.remove);
	const next = labelIds.filter((id) => !removed.has(id));
	for (const id of delta.add) if (!next.includes(id)) next.push(id);
	return next;
}

/** Apply several pending deltas in mutation order, for rapid keyboard writes
 * against the same id. */
export function applyLabelDeltas(labelIds: string[], deltas: LabelDelta[]): string[] {
	return deltas.reduce(applyLabelDelta, labelIds);
}

/**
 * Whether a row with these labels belongs in a list filtered by `queryLabel`
 * (undefined = all/any view). This mirrors the one read-model rule optimism is
 * allowed to reproduce: a label filter requires that label, and `TRASH` is
 * hidden from every view except Trash. Search, counts, and ordering stay owned
 * by the reconciling server refetch.
 */
export function rowMatchesLabelFilter(
	labelIds: string[],
	queryLabel: string | undefined,
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
	queryLabel: string | undefined,
): MessageSummary[] {
	return messages
		.map((message) => {
			const deltas = pendingWrites
				.filter((write) => write.id === message.id)
				.map((write) => write.delta);
			if (deltas.length === 0) return message;
			return { ...message, labelIds: applyLabelDeltas(message.labelIds, deltas) };
		})
		.filter((message) => rowMatchesLabelFilter(message.labelIds, queryLabel));
}
