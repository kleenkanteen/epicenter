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
	type Approval,
	type ConversationHandle,
	composeToolCatalogs,
	createConversation,
	createLocalToolCatalog,
	namespaceToolCatalog,
	type ToolCatalog,
} from '@epicenter/workspace/agent';
import { bunLocalPersistence } from '@epicenter/workspace/node';
import { createInMemoryMessageStore } from './message-store.ts';
import {
	createStdioMcpCatalog,
	type StdioMcpCatalogOptions,
} from './stdio-mcp-catalog.ts';
export type {
	ToolHost,
	ToolModule,
	ToolModuleResult,
	ToolWorkspaces,
} from './tool-module.ts';

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
	/** Host-owned data directory for installed app replicas and node identity. */
	dataDir?: string;
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
			await Promise.all([
				honeycrisp.storage.whenDisposed,
				todos.storage.whenDisposed,
			]);
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
