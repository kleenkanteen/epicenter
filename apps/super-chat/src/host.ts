/**
 * The Super Chat host: one local desktop chat session; installed apps enter
 * through one verb catalog (ADR-0080). User-curated Yjs apps mount in-process
 * as action registries (arm A); boxed apps an upstream forces off the mesh
 * join as local stdio MCP subprocesses (arm B, Local Books today). One agent
 * loop consumes the composed catalog and never learns where a verb lives.
 *
 * The install list is static and code-owned: this file IS the discovery
 * mechanism for the first slice (no registry, no scanned tool files; dynamic
 * loading waits for the tool module contract ADR named in ADR-0084).
 *
 * The in-process apps open through their zero-attachment `create()` factories:
 * in-memory Y.Docs with no persistence, no sync, no IndexedDB or SQLite. That
 * is a deliberate proof of composition, not the data model; the ungated
 * durable local open path is the named gap between "composition proof" and
 * "loads my workspaces" (see the Super Chat handoff spec).
 */

import { honeycrispWorkspace } from '@epicenter/honeycrisp';
import { createTodos } from '@epicenter/todos';
import { generateId } from '@epicenter/workspace';
import {
	type AgentEngine,
	type Approval,
	type ConversationHandle,
	composeToolCatalogs,
	createConversation,
	createLocalToolCatalog,
	namespaceToolCatalog,
	type ToolCatalog,
} from '@epicenter/workspace/agent';
import { createInMemoryMessageStore } from './message-store.ts';
import {
	createStdioMcpCatalog,
	type StdioMcpCatalogOptions,
} from './stdio-mcp-catalog.ts';

export type SuperChatHostOptions = {
	/** The inference backend driving the loop (BYOK, local, or scripted). */
	engine: AgentEngine;
	/**
	 * The approval policy for gated mutations. Omit for the loop's default:
	 * queries run unattended, mutations are denied (no prompt surface exists
	 * headless, and deny-by-default is the safe floor until the shell wires one).
	 */
	approval?: Approval;
	/**
	 * Spawn command for the Local Books stdio MCP server (arm B). Omitted =
	 * not installed; the host runs with the in-process apps only.
	 */
	localBooks?: StdioMcpCatalogOptions;
};

export type SuperChatHost = {
	/** The one chat session (ADR-0080: a single host session, not per-app). */
	conversation: ConversationHandle;
	/** The composed verb surface, for shells that list or introspect tools. */
	tools: ToolCatalog;
	[Symbol.asyncDispose](): Promise<void>;
};

/**
 * Open the installed apps, compose their catalogs, and start the one chat
 * session over them. Async only when arm B spawns (the MCP handshake).
 */
export async function createSuperChatHost(
	options: SuperChatHostOptions,
): Promise<SuperChatHost> {
	// Arm A: in-process Yjs apps. Each app's namespace keeps same-named verbs
	// distinct in the composed surface; the prefix must not contain `__`.
	const honeycrisp = honeycrispWorkspace.create();
	const todos = createTodos();
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
	const conversation = createConversation({
		store: createInMemoryMessageStore(),
		engine: options.engine,
		tools,
		...(options.approval !== undefined && { approval: options.approval }),
		generateId,
	});

	return {
		conversation,
		tools,
		async [Symbol.asyncDispose]() {
			// The conversation first (aborts any in-flight turn and disposes the
			// store), then the subprocess, then the in-process docs.
			conversation[Symbol.dispose]();
			await localBooks?.[Symbol.asyncDispose]();
			honeycrisp[Symbol.dispose]();
			todos[Symbol.dispose]();
		},
	};
}
