import { defineErrors, type InferErrors } from 'wellcrafted/error';
import { Ok, type Result } from 'wellcrafted/result';
import type { MailDb } from './db.ts';
import type { GmailClient, GmailClientError } from './gmail-client.ts';
import type { GmailMessage } from './schema.ts';

export const ModifyMessageLabelsError = defineErrors({
	ReadOnly: () => ({
		message:
			'Refusing to write: read-only mode is set (LOCAL_MAIL_READ_ONLY), so Gmail label mutations are disabled. query, status, and sync stay available.',
	}),
	NoMessageIds: () => ({
		message: 'At least one Gmail message id is required.',
	}),
	TooManyMessageIds: ({ count }: { count: number }) => ({
		message: `Gmail messages.modify is run serially by id; pass at most 100 ids, got ${count}.`,
		count,
	}),
	EmptyLabelMutation: () => ({
		message: 'At least one label id must be added or removed.',
	}),
});
export type ModifyMessageLabelsError = InferErrors<
	typeof ModifyMessageLabelsError
>;

export const ResolveLabelIdsError = defineErrors({
	UnknownLabel: ({ label }: { label: string }) => ({
		message: `Unknown Gmail label "${label}". Create it in Gmail, sync labels, or pass the label id.`,
		label,
	}),
});
export type ResolveLabelIdsError = InferErrors<typeof ResolveLabelIdsError>;

type ErrorSummary = {
	name: string;
	message: string;
};

export type ModifyMessageLabelsResult = {
	id: string;
	labelIds: string[] | null;
	folded: boolean;
	error: ErrorSummary | null;
};

export type ModifyMessageLabelsOutcome = {
	results: ModifyMessageLabelsResult[];
	aborted: ErrorSummary | null;
};

type ModifyDeps = {
	client: GmailClient;
	db: MailDb;
	now: () => number;
};

export type ModifyMessageLabelsInput = {
	ids: string[];
	addLabelIds: string[];
	removeLabelIds: string[];
};

function isPerIdError(error: GmailClientError): boolean {
	return (
		error.name === 'Http' && (error.status === 400 || error.status === 404)
	);
}

function tryFoldMessageLabels({
	db,
	id,
	labelIds,
	syncedAt,
}: {
	db: MailDb;
	id: string;
	labelIds: string[];
	syncedAt: string;
}): boolean {
	try {
		return db.patchMessageLabels(id, labelIds, syncedAt);
	} catch {
		return false;
	}
}

/**
 * Run one per-message Gmail write per id and fold each accepted response's
 * `labelIds` into the mirror. The shared spine of every message mutation
 * (label modify, trash, untrash): Gmail is authoritative, SQLite is a
 * disposable fold. A 400/404 is about that id alone and the loop continues; a
 * token, throttle, or network error is systemic and aborts the rest. `mutate`
 * is the only thing that varies, so each caller supplies just its Gmail call.
 */
async function foldMessageMutations({
	deps,
	ids,
	mutate,
}: {
	deps: ModifyDeps;
	ids: string[];
	mutate: (id: string) => Promise<Result<GmailMessage, GmailClientError>>;
}): Promise<ModifyMessageLabelsOutcome> {
	const results: ModifyMessageLabelsResult[] = [];
	for (const id of ids) {
		const { data: message, error } = await mutate(id);
		if (error) {
			const summary: ErrorSummary = {
				name: error.name,
				message: error.message,
			};
			results.push({ id, labelIds: null, folded: false, error: summary });
			if (isPerIdError(error)) continue;
			return { results, aborted: summary };
		}

		if (!message.labelIds) {
			results.push({ id, labelIds: null, folded: false, error: null });
			continue;
		}

		const syncedAt = new Date(deps.now()).toISOString();
		const folded = tryFoldMessageLabels({
			db: deps.db,
			id,
			labelIds: message.labelIds,
			syncedAt,
		});
		results.push({ id, labelIds: message.labelIds, folded, error: null });
	}

	return { results, aborted: null };
}

export async function resolveLabelIds({
	deps,
	labels,
}: {
	deps: ModifyDeps;
	labels: string[];
}): Promise<Result<string[], ResolveLabelIdsError | GmailClientError>> {
	const resolved: string[] = [];
	let refreshed = false;

	for (const label of labels) {
		let row = deps.db.findLabelByIdOrExactName(label);
		if (!row && !refreshed) {
			const { data, error } = await deps.client.listLabels();
			if (error) return { data: null, error };
			deps.db.ingestLabels(data, new Date(deps.now()).toISOString());
			refreshed = true;
			row = deps.db.findLabelByIdOrExactName(label);
		}
		if (!row) return ResolveLabelIdsError.UnknownLabel({ label });
		resolved.push(row.id);
	}

	return Ok(resolved);
}

export async function modifyMessageLabels({
	deps,
	input,
	readOnly,
}: {
	deps: ModifyDeps;
	input: ModifyMessageLabelsInput;
	/**
	 * Required so every adapter decides explicitly whether Gmail writes are
	 * allowed. The core owns this invariant, not the CLI or MCP surface.
	 */
	readOnly: boolean;
}): Promise<Result<ModifyMessageLabelsOutcome, ModifyMessageLabelsError>> {
	if (readOnly) return ModifyMessageLabelsError.ReadOnly();
	if (input.ids.length === 0) return ModifyMessageLabelsError.NoMessageIds();
	if (input.ids.length > 100) {
		return ModifyMessageLabelsError.TooManyMessageIds({
			count: input.ids.length,
		});
	}
	if (input.addLabelIds.length === 0 && input.removeLabelIds.length === 0) {
		return ModifyMessageLabelsError.EmptyLabelMutation();
	}

	return Ok(
		await foldMessageMutations({
			deps,
			ids: input.ids,
			mutate: (id) =>
				deps.client.modifyMessage(id, {
					addLabelIds: input.addLabelIds,
					removeLabelIds: input.removeLabelIds,
				}),
		}),
	);
}

export const TrashMessagesError = defineErrors({
	ReadOnly: () => ({
		message:
			'Refusing to write: read-only mode is set (LOCAL_MAIL_READ_ONLY), so Gmail trash is disabled. query, status, and sync stay available.',
	}),
	NoMessageIds: () => ({
		message: 'At least one Gmail message id is required.',
	}),
	TooManyMessageIds: ({ count }: { count: number }) => ({
		message: `Gmail messages.trash is run serially by id; pass at most 100 ids, got ${count}.`,
		count,
	}),
});
export type TrashMessagesError = InferErrors<typeof TrashMessagesError>;

/**
 * Move messages to Gmail's Trash, or restore them: the write behind the UI's
 * "Move to trash" button and its Undo. Gmail models trash/untrash as their own
 * endpoints, distinct from `messages.modify`, so this is a dedicated verb rather
 * than a label delta forced through add/remove. It needs only the `gmail.modify`
 * scope; the permanent `messages.delete` is deliberately never wired. Like the
 * label core it writes Gmail first and folds the returned `labelIds` into the
 * mirror. Because `listMessages` hides `TRASH`-labeled rows, a trashed message
 * leaves every triage view at once; Undo untrashes and folds again, restoring
 * it wherever Gmail's returned labels place it.
 */
export async function setMessagesTrashed({
	deps,
	ids,
	trashed,
	readOnly,
}: {
	deps: ModifyDeps;
	ids: string[];
	/** Target state: `true` trashes (`messages.trash`), `false` restores it
	 * (`messages.untrash`). The two endpoints share this one fold spine. */
	trashed: boolean;
	readOnly: boolean;
}): Promise<Result<ModifyMessageLabelsOutcome, TrashMessagesError>> {
	if (readOnly) return TrashMessagesError.ReadOnly();
	if (ids.length === 0) return TrashMessagesError.NoMessageIds();
	if (ids.length > 100) {
		return TrashMessagesError.TooManyMessageIds({ count: ids.length });
	}

	return Ok(
		await foldMessageMutations({
			deps,
			ids,
			mutate: (id) =>
				trashed ? deps.client.trashMessage(id) : deps.client.untrashMessage(id),
		}),
	);
}

/**
 * The adapter path both the CLI `modify` verb and the MCP `modify_labels` tool
 * take: resolve label names to Gmail ids, then run the core. The core refuses
 * read-only mode before touching the network, so name resolution (which can
 * hit `labels.list`) is skipped entirely in that mode.
 */
export async function resolveAndModifyMessageLabels({
	deps,
	ids,
	addLabels,
	removeLabels,
	readOnly,
}: {
	deps: ModifyDeps;
	ids: string[];
	addLabels: string[];
	removeLabels: string[];
	readOnly: boolean;
}): Promise<
	Result<
		ModifyMessageLabelsOutcome,
		ModifyMessageLabelsError | ResolveLabelIdsError | GmailClientError
	>
> {
	if (readOnly) {
		return modifyMessageLabels({
			deps,
			input: { ids, addLabelIds: addLabels, removeLabelIds: removeLabels },
			readOnly: true,
		});
	}

	const { data: resolved, error } = await resolveLabelIds({
		deps,
		labels: [...addLabels, ...removeLabels],
	});
	if (error) return { data: null, error };

	return modifyMessageLabels({
		deps,
		input: {
			ids,
			addLabelIds: resolved.slice(0, addLabels.length),
			removeLabelIds: resolved.slice(addLabels.length),
		},
		readOnly: false,
	});
}
