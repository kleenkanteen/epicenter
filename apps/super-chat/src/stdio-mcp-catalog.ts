/**
 * The boxed-app {@link ToolCatalog}: a co-located stdio MCP subprocess joins
 * the same catalog seam the in-process apps use (ADR-0080 arm B). Spawn the
 * server (`local-books mcp` today), run the MCP handshake, list the tools once,
 * and map each `tools/call` onto {@link ToolCatalog.resolve}. The subprocess
 * keeps its data private; the host sees verbs only.
 *
 * This is deliberately app-local, not a `@epicenter/workspace` primitive: the
 * shipped `createMcpGatewayCatalog` binds the relay-floor `PeerTransport`, and
 * Super Chat is that adapter's first (and so far only) local-stdio consumer.
 * Promote it to the shared package when a second consumer appears, not before.
 *
 * The projection rules mirror the gateway catalog's: a tool counts as a
 * `query` only when it publishes `readOnlyHint: true`, so an absent or false
 * hint tightens to a gated `mutation`, never loosens (ADR-0073).
 */

import type {
	AgentToolCall,
	AgentToolDefinition,
	AgentToolOutcome,
	ToolCatalog,
} from '@epicenter/workspace/agent';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
	getDefaultEnvironment,
	StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { JsonValue } from 'wellcrafted/json';

export type StdioMcpCatalogOptions = {
	/** The executable that starts the MCP server (e.g. `bun`). */
	command: string;
	/** Arguments to the executable (e.g. the server script plus its flags). */
	args?: string[];
	/**
	 * Extra environment for the subprocess, merged over the SDK's safe-to-inherit
	 * defaults (HOME, PATH, ...). The subprocess never sees this process's full
	 * environment unless a variable is passed here explicitly.
	 */
	env?: Record<string, string>;
};

/**
 * A {@link ToolCatalog} backed by a live stdio MCP session, plus the disposer
 * that closes the session and reaps the subprocess.
 */
export type StdioMcpCatalog = ToolCatalog & {
	[Symbol.asyncDispose](): Promise<void>;
};

/**
 * Spawn the stdio MCP server, run the handshake, and return a catalog whose
 * `definitions()` is the cached `tools/list` and whose `resolve()` is
 * `tools/call`. Async because the `initialize` + `tools/list` round-trip
 * happens up front, so the loop's synchronous `definitions()` needs no await.
 */
export async function createStdioMcpCatalog(
	options: StdioMcpCatalogOptions,
): Promise<StdioMcpCatalog> {
	const client = new Client({ name: 'super-chat', version: '0.0.0' });
	const transport = new StdioClientTransport({
		command: options.command,
		...(options.args !== undefined && { args: options.args }),
		env: { ...getDefaultEnvironment(), ...options.env },
	});

	try {
		await client.connect(transport);
	} catch (error) {
		await transport.close().catch(() => {});
		throw error;
	}
	const listed = await client.listTools().catch(async (error) => {
		await client.close().catch(() => {});
		throw error;
	});
	const definitions = listed.tools.map(toAgentToolDefinition);

	return {
		definitions: () => definitions,
		async resolve(
			call: AgentToolCall,
			signal: AbortSignal,
		): Promise<AgentToolOutcome> {
			try {
				const result = (await client.callTool(
					{ name: call.toolName, arguments: asArguments(call.input) },
					undefined,
					{ signal },
				)) as CallToolResult;
				return toToolOutcome(result);
			} catch (error) {
				return {
					output: error instanceof Error ? error.message : String(error),
					isError: true,
				};
			}
		},
		async [Symbol.asyncDispose]() {
			try {
				await client.close();
			} catch {
				// Already closed / subprocess gone: nothing to reap.
			}
		},
	};
}

/**
 * Project an MCP {@link Tool} to an {@link AgentToolDefinition}. `kind` is the
 * honest query-vs-mutation bit (ADR-0044): only a published
 * `readOnlyHint: true` earns `query`.
 */
function toAgentToolDefinition(tool: Tool): AgentToolDefinition {
	return {
		name: tool.name,
		kind: tool.annotations?.readOnlyHint === true ? 'query' : 'mutation',
		...(tool.title !== undefined && { title: tool.title }),
		...(tool.description !== undefined && { description: tool.description }),
		...(tool.inputSchema !== undefined && {
			inputSchema: tool.inputSchema as JsonValue,
		}),
	};
}

/** MCP `arguments` is an object; a non-object tool input is sent as `{}`. */
function asArguments(input: JsonValue): Record<string, unknown> {
	return input !== null && typeof input === 'object' && !Array.isArray(input)
		? (input as Record<string, unknown>)
		: {};
}

/**
 * Flatten an MCP {@link CallToolResult} into an {@link AgentToolOutcome}. Text
 * parts join into one string; a result carrying non-text content falls back to
 * the raw content array as a JSON value. `isError` rides the MCP flag.
 */
function toToolOutcome(result: CallToolResult): AgentToolOutcome {
	const isError = result.isError === true;
	const textParts = result.content.filter(
		(part): part is { type: 'text'; text: string } => part.type === 'text',
	);
	const allText = textParts.length === result.content.length;
	const output: JsonValue = allText
		? textParts.map((part) => part.text).join('\n')
		: (result.content as JsonValue);
	return { output, isError };
}
