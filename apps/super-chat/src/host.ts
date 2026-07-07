/**
 * The Super Chat host: one local desktop chat session; built-in apps enter
 * through one verb catalog (ADR-0080). Built-in Yjs apps mount in-process
 * as action registries (arm A); boxed apps an upstream forces off the mesh
 * may join as local stdio MCP subprocesses (arm B, Local Books today). One
 * agent loop consumes the composed catalog and never learns where a verb lives.
 *
 * The in-process apps open through the ungated durable local preset:
 * `connect(null, { persistence })`. Sign-in is still an enhancement; the Bun
 * host gets disk-backed replicas without constructing an auth client.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { honeycrispWorkspace } from '@epicenter/honeycrisp';
import { todosWorkspace } from '@epicenter/todos';
import { createNodeId, generateId } from '@epicenter/workspace';
import {
	type AgentEngine,
	type AgentToolCall,
	type AgentToolDefinition,
	type Approval,
	type ConversationHandle,
	type ConversationSnapshot,
	composeToolCatalogs,
	createConversation,
	createLocalToolCatalog,
	defaultApprovalDecision,
	namespaceToolCatalog,
	type ToolCatalog,
} from '@epicenter/workspace/agent';
import { bunLocalPersistence } from '@epicenter/workspace/node';
import { createInMemoryMessageStore } from './message-store.ts';
import {
	createStdioMcpCatalog,
	type StdioMcpCatalogOptions,
} from './stdio-mcp-catalog.ts';

export type SuperChatHostOptions = {
	/** The inference backend driving the loop (BYOK, local, or scripted). */
	engine: AgentEngine;
	/**
	 * Override the host-owned approval prompt. Tests use this for headless
	 * auto-approval; the shell omits it so pending mutations surface in-session.
	 */
	approval?: Approval;
	/**
	 * Spawn command for the Local Books stdio MCP server (arm B). Omitted means
	 * the host runs with the built-in apps only.
	 */
	localBooks?: StdioMcpCatalogOptions;
	/** Host-owned data directory for built-in app replicas and node identity. */
	dataDir?: string;
};

export type PendingApproval = {
	id: string;
	toolCallId: string;
	toolName: string;
	title?: string;
	description?: string;
	input: AgentToolCall['input'];
	requestedAt: number;
};

export type SuperChatSessionSnapshot = {
	conversation: ConversationSnapshot;
	pendingApprovals: PendingApproval[];
	activity: SuperChatActivity[];
};

export type SuperChatActivity = {
	id: string;
	createdAt: number;
	type: 'approval-requested' | 'approval-resolved';
	requestId: string;
	toolCallId: string;
	toolName: string;
	approved?: boolean;
};

/** What a session client may ask of the one host-owned session. */
export type SuperChatClientCommand =
	| { type: 'send'; content: string }
	| { type: 'stop' }
	| { type: 'retry' }
	| {
			type: 'approve';
			requestId: string;
			approved: boolean;
			alwaysAllowSession?: boolean;
	  };

/** What the server pushes: the full render state, on every host change. */
export type SuperChatServerEvent = {
	type: 'snapshot';
	snapshot: SuperChatSessionSnapshot;
};

export type SuperChatSessionResponse = {
	tools: AgentToolDefinition[];
	snapshot: SuperChatSessionSnapshot;
};

export type SuperChatHost = {
	/** The one chat session (ADR-0080: a single host session, not per-app). */
	conversation: ConversationHandle;
	/** The composed verb surface, for shells that list or introspect tools. */
	tools: ToolCatalog;
	/** Read the render state owned by the host session. */
	snapshot(): SuperChatSessionSnapshot;
	/** Register for any conversation or approval-state change. */
	subscribe(listener: () => void): () => void;
	/** Apply one client command to the host-owned session. */
	handleCommand(command: SuperChatClientCommand): boolean;
	[Symbol.asyncDispose](): Promise<void>;
};

const ACTIVITY_LIMIT = 50;

/**
 * Open the built-in apps, compose their catalogs, and start the one chat
 * session over them.
 */
export async function createSuperChatHost(
	options: SuperChatHostOptions,
): Promise<SuperChatHost> {
	// Arm A: in-process Yjs apps. Each app's namespace keeps same-named verbs
	// distinct in the composed surface; the prefix must not contain `__`.
	const dataDir = options.dataDir ?? defaultDataDir();
	const nodeId = createNodeId({
		storage: fileStorage(join(dataDir, 'node-id')),
	});
	const persistence = bunLocalPersistence({ dir: dataDir, nodeId });
	const honeycrisp = honeycrispWorkspace.connect(null, { persistence });
	const todos = todosWorkspace.connect(null, { persistence });
	await Promise.all([honeycrisp.storage.whenLoaded, todos.storage.whenLoaded]);
	const catalogs: ToolCatalog[] = [
		namespaceToolCatalog(
			'honeycrisp',
			createLocalToolCatalog(honeycrisp.actions),
		),
		namespaceToolCatalog('todos', createLocalToolCatalog(todos.actions)),
	];

	// Arm B: boxed apps join as stdio MCP subprocesses behind the same seam.
	const localBooks = options.localBooks
		? await createStdioMcpCatalog(options.localBooks).catch((error) => {
				honeycrisp[Symbol.dispose]();
				todos[Symbol.dispose]();
				throw error;
			})
		: undefined;
	if (localBooks) {
		catalogs.push(namespaceToolCatalog('localbooks', localBooks));
	}

	const tools = composeToolCatalogs(catalogs);
	const listeners = new Set<() => void>();
	const notify = () => {
		for (const listener of listeners) listener();
	};
	const activity: SuperChatActivity[] = [];
	const recordActivity = (
		entry: Omit<SuperChatActivity, 'id' | 'createdAt'>,
	) => {
		activity.push({ id: generateId(), createdAt: Date.now(), ...entry });
		if (activity.length > ACTIVITY_LIMIT)
			activity.splice(0, activity.length - ACTIVITY_LIMIT);
		notify();
	};
	const sessionApproval = createSessionApproval(recordActivity);
	const conversation = createConversation({
		store: createInMemoryMessageStore(),
		engine: options.engine,
		tools,
		approval: options.approval ?? sessionApproval.approval,
		generateId,
	});

	return {
		conversation,
		tools,
		snapshot() {
			return {
				conversation: conversation.snapshot(),
				pendingApprovals: sessionApproval.pending(),
				activity: [...activity],
			};
		},
		subscribe(listener) {
			listeners.add(listener);
			const unsubscribeConversation = conversation.subscribe(listener);
			return () => {
				listeners.delete(listener);
				unsubscribeConversation();
			};
		},
		handleCommand(command) {
			switch (command.type) {
				case 'send':
					return conversation.send(command.content);
				case 'stop':
					conversation.stop();
					sessionApproval.cancelAll();
					return true;
				case 'retry':
					conversation.retry();
					return true;
				case 'approve':
					return sessionApproval.answer({
						requestId: command.requestId,
						approved: command.approved,
						alwaysAllowSession: command.alwaysAllowSession === true,
					});
				default:
					command satisfies never;
					return false;
			}
		},
		async [Symbol.asyncDispose]() {
			// The conversation first (aborts any in-flight turn and disposes the
			// store), then the subprocess, then the in-process docs.
			conversation[Symbol.dispose]();
			sessionApproval.cancelAll();
			await localBooks?.[Symbol.asyncDispose]();
			honeycrisp[Symbol.dispose]();
			todos[Symbol.dispose]();
			await Promise.all([
				honeycrisp.storage.whenDisposed,
				todos.storage.whenDisposed,
			]);
		},
	};
}

function createSessionApproval(
	recordActivity: (entry: Omit<SuperChatActivity, 'id' | 'createdAt'>) => void,
) {
	const pending = new Map<
		string,
		{
			prompt: PendingApproval;
			resolve(approved: boolean): void;
		}
	>();
	const sessionGrants = new Set<string>();

	const approval: Approval = {
		decide(call, definition) {
			if (sessionGrants.has(call.toolName)) return 'auto';
			return defaultApprovalDecision(call, definition);
		},
		request(call, definition) {
			const id = generateId();
			const prompt: PendingApproval = {
				id,
				toolCallId: call.toolCallId,
				toolName: call.toolName,
				...(definition.title !== undefined && { title: definition.title }),
				...(definition.description !== undefined && {
					description: definition.description,
				}),
				input: call.input,
				requestedAt: Date.now(),
			};
			return new Promise<boolean>((resolve) => {
				pending.set(id, { prompt, resolve });
				recordActivity({
					type: 'approval-requested',
					requestId: id,
					toolCallId: call.toolCallId,
					toolName: call.toolName,
				});
			});
		},
	};

	return {
		approval,
		pending() {
			return [...pending.values()].map(({ prompt }) => prompt);
		},
		answer({
			requestId,
			approved,
			alwaysAllowSession,
		}: {
			requestId: string;
			approved: boolean;
			alwaysAllowSession: boolean;
		}) {
			const entry = pending.get(requestId);
			if (!entry) return false;
			pending.delete(requestId);
			if (approved && alwaysAllowSession) {
				sessionGrants.add(entry.prompt.toolName);
			}
			entry.resolve(approved);
			recordActivity({
				type: 'approval-resolved',
				requestId,
				toolCallId: entry.prompt.toolCallId,
				toolName: entry.prompt.toolName,
				approved,
			});
			return true;
		},
		cancelAll() {
			if (pending.size === 0) return;
			const entries = [...pending.values()];
			pending.clear();
			for (const entry of entries) {
				entry.resolve(false);
				recordActivity({
					type: 'approval-resolved',
					requestId: entry.prompt.id,
					toolCallId: entry.prompt.toolCallId,
					toolName: entry.prompt.toolName,
					approved: false,
				});
			}
		},
	};
}

function defaultDataDir(): string {
	if (process.env.SUPER_CHAT_DATA_DIR) return process.env.SUPER_CHAT_DATA_DIR;
	if (platform() === 'darwin') {
		return join(
			homedir(),
			'Library',
			'Application Support',
			'epicenter-super-chat',
		);
	}
	const xdgDataHome = process.env.XDG_DATA_HOME;
	if (xdgDataHome) return join(xdgDataHome, 'epicenter-super-chat');
	return join(homedir(), '.local', 'share', 'epicenter-super-chat');
}

function fileStorage(filePath: string) {
	return {
		getItem(key: string): string | null {
			if (key !== 'epicenter.node.id') return null;
			if (!existsSync(filePath)) return null;
			return readFileSync(filePath, 'utf8');
		},
		setItem(key: string, value: string): void {
			if (key !== 'epicenter.node.id') return;
			mkdirSync(dirname(filePath), { recursive: true });
			writeFileSync(filePath, value);
		},
	};
}
