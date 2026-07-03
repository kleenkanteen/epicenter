/**
 * An intentionally ephemeral message store: the agent loop's persistence seam
 * over an in-memory Y.Doc that nothing syncs or saves. Chat history lives for
 * one host process and dies with it.
 *
 * Deliberate: durable transcripts are an open product decision (append-only
 * JSONL vs an Epicenter workspace; see the Super Chat handoff spec), and tool
 * results can carry data ADR-0080's confidentiality rule keeps off any hosted
 * readable plane. Until that decision is made, not persisting is the only
 * shape that cannot leak.
 */

import { attachRecords } from '@epicenter/workspace';
import type {
	AgentMessage,
	ConversationOptions,
} from '@epicenter/workspace/agent';
import * as Y from 'yjs';

/** The store slot of {@link ConversationOptions}: what the loop actually needs. */
export type AgentMessageStore = ConversationOptions['store'];

export function createInMemoryMessageStore(): AgentMessageStore {
	const doc = new Y.Doc();
	const handle = attachRecords<AgentMessage>(doc);
	return Object.assign(handle, {
		[Symbol.dispose]() {
			doc.destroy();
		},
	});
}
