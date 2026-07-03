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
	ReadOnlyGrant: () => ({
		message:
			'This account was connected read-only. Run "local-mail connect" again to grant Gmail write access, then retry.',
	}),
});
export type ModifyMessageLabelsError = InferErrors<
	typeof ModifyMessageLabelsError
>;

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

type ModifyMessageLabelsDeps = {
	client: GmailClient;
	db: MailDb;
	now: () => number;
};

export type ModifyMessageLabelsInput = {
	ids: string[];
	addLabelIds: string[];
	removeLabelIds: string[];
};

function summarizeError(error: { name: string; message: string }): ErrorSummary {
	return { name: error.name, message: error.message };
}

function errorReason(body: string): string | null {
	try {
		const parsed = JSON.parse(body) as {
			error?: { errors?: { reason?: string }[]; status?: string };
		};
		return parsed.error?.errors?.[0]?.reason ?? parsed.error?.status ?? null;
	} catch {
		return null;
	}
}

function isReadOnlyGrant(error: GmailClientError): boolean {
	return (
		error.name === 'Http' &&
		error.status === 403 &&
		errorReason(error.body) === 'insufficientPermissions'
	);
}

function isPerIdError(error: GmailClientError): boolean {
	return error.name === 'Http' && (error.status === 400 || error.status === 404);
}

function abortSummary(error: GmailClientError): ErrorSummary {
	if (isReadOnlyGrant(error)) {
		return summarizeError(ModifyMessageLabelsError.ReadOnlyGrant().error);
	}
	return summarizeError(error);
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

export async function modifyMessageLabels({
	deps,
	input,
	readOnly,
}: {
	deps: ModifyMessageLabelsDeps;
	input: ModifyMessageLabelsInput;
	/**
	 * Required so every adapter decides explicitly whether Gmail writes are
	 * allowed. The core owns this invariant, not the CLI or MCP surface.
	 */
	readOnly: boolean;
}): Promise<
	Result<
		ModifyMessageLabelsOutcome,
		ModifyMessageLabelsError
	>
> {
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
			const summary = summarizeError(error);
			if (isPerIdError(error)) {
				results.push({ id, labelIds: null, folded: false, error: summary });
				continue;
			}
			const aborted = abortSummary(error);
			results.push({ id, labelIds: null, folded: false, error: aborted });
			return Ok({ results, aborted });
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
