// The `/api` wire shapes, mirrored from `apps/local-mail/src` (db.ts read models
// and modify.ts). Kept as a small hand-copy rather than a cross-package import
// so the SPA builds standalone; the contract is stable (Phase 3 froze
// `ModifyMessageLabelsOutcome`, up-shell spec froze the routes).

export type MailboxStatus = {
	accountEmail: string;
	connected: boolean;
	mirror: 'empty' | 'building' | 'ready';
	historyId: string | null;
	lastSyncedAt: string | null;
	lastFullPullAt: string | null;
	rows: { messages: number; labels: number };
	readOnly: boolean;
};

export type MailLabel = {
	id: string;
	name: string | null;
	type: string | null;
};

export type MessageSummary = {
	id: string;
	threadId: string | null;
	subject: string | null;
	sender: string | null;
	snippet: string | null;
	internalDate: number | null;
	labelIds: string[];
};

export type MessageDetail = MessageSummary & {
	to: string | null;
	date: string | null;
	bodyText: string | null;
};

/** Per-id result of one `messages.modify`. `folded: false` means Gmail accepted
 * the change but the mirror row was not patched from the response, so it catches
 * up on the next sync. */
export type ModifyMessageLabelsResult = {
	id: string;
	labelIds: string[] | null;
	folded: boolean;
	error: { name: string; message: string } | null;
};

/** The one contract shared by CLI, MCP, and this HTTP route. A systemic abort
 * (token, throttle, network) sets `aborted` and stops the remaining ids. */
export type ModifyMessageLabelsOutcome = {
	results: ModifyMessageLabelsResult[];
	aborted: { name: string; message: string } | null;
};

export type SyncOutcome = {
	mode: 'FULL' | 'INCREMENTAL';
	reason: string;
	cursorBefore: string | null;
	cursorAfter: string | null;
	messagesUpserted: number;
	messagesDeleted: number;
	labelsPatched: number;
	failure: { name: string; message: string } | null;
};
