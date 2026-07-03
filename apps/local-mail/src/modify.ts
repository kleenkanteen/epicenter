import { defineErrors, type InferErrors } from 'wellcrafted/error';
import { Ok, type Result } from 'wellcrafted/result';
import type { MailDb } from './db.ts';
import type { GmailClient, GmailClientError } from './gmail-client.ts';

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

	const results: ModifyMessageLabelsResult[] = [];
	for (const id of input.ids) {
		const { data: message, error } = await deps.client.modifyMessage(id, {
			addLabelIds: input.addLabelIds,
			removeLabelIds: input.removeLabelIds,
		});
		if (error) {
			const summary: ErrorSummary = {
				name: error.name,
				message: error.message,
			};
			results.push({ id, labelIds: null, folded: false, error: summary });
			// A 400/404 is about this id alone; a token, throttle, or network
			// error is systemic, so stop attempting the rest.
			if (isPerIdError(error)) continue;
			return Ok({ results, aborted: summary });
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

		results.push({
			id,
			labelIds: message.labelIds,
			folded,
			error: null,
		});
	}

	return Ok({ results, aborted: null });
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
