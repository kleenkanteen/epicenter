/**
 * `local-mail mcp`: a stdio Model Context Protocol server that exposes read
 * and refresh verbs over the local Gmail mirror to a foreign host (Claude Code,
 * Codex, Cursor, ...).
 *
 * Why MCP, and why local stdio: Local Mail is a private Gmail mirror for local
 * tools. A subprocess reading the local SQLite directly is the exposure that
 * keeps mail data on the machine while still speaking the vocabulary foreign
 * hosts already understand. So "let an agent use Local Mail" reduces to this
 * file: it adds no mesh, no relay, no shared workspace state.
 *
 * The shape: each tool is one entry in `TOOLS` whose `input` is a TypeBox
 * schema. TypeBox IS JSON Schema at runtime, so the same object is the MCP
 * `inputSchema` (serialized over the wire) AND the validator (`Value.Check`,
 * in-process), with zero duplication. Each `run` maps straight onto an
 * existing Result-returning core.
 *
 * stdout is the JSON-RPC channel, so this subcommand prints NOTHING to stdout
 * except protocol frames: no banners, no `console.log`, no progress. The cores
 * are handed no `log` sink (their default is a no-op), so nothing leaks; a
 * single stray byte would corrupt framing.
 *
 * Error model (MCP's two channels):
 *  - unknown tool / invalid arguments -> `throw new McpError(...)`, a JSON-RPC
 *    protocol error (the call itself was malformed).
 *  - a tool that ran and failed (bad SQL, no account, a Gmail sync failure) ->
 *    a normal result with `isError: true` and a text message, so the model can
 *    read it and self-correct.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	type CallToolResult,
	ErrorCode,
	ListToolsRequestSchema,
	McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { type Static, type TObject, Type } from 'typebox';
import { Value } from 'typebox/value';
import { Err, Ok, type Result } from 'wellcrafted/result';
import type { AppConfig } from './config.ts';
import { openMailDb } from './db.ts';
import { createGmailClient } from './gmail-client.ts';
import { dbPath } from './paths.ts';
import { queryMail } from './query.ts';
import { readMailStatus } from './status.ts';
import { syncMailbox } from './sync.ts';
import { createTokenManager } from './token-manager.ts';
import {
	createFileTokenStore,
	resolveAccount,
	type TokenStore,
} from './token-store.ts';
import { VERSION } from './cli.ts';
import { loadConfig } from './config.ts';

type ToolContext = {
	config: AppConfig;
	accountEmail: string;
	store: TokenStore;
	now: () => number;
};

type ToolOutcome = Result<unknown, { message: string }>;

type ToolDescriptor = {
	name: string;
	title: string;
	description: string;
	input: TObject;
	tier: 'read' | 'write';
	run: (
		ctx: ToolContext,
		args: Record<string, unknown>,
	) => Promise<ToolOutcome>;
};

function defineMcpTool<S extends TObject>(tool: {
	name: string;
	title: string;
	description: string;
	input: S;
	tier: 'read' | 'write';
	run: (ctx: ToolContext, args: Static<S>) => Promise<ToolOutcome>;
}): ToolDescriptor {
	return { ...tool, run: (ctx, args) => tool.run(ctx, args as Static<S>) };
}

const TOOLS: ToolDescriptor[] = [
	defineMcpTool({
		name: 'query',
		title: 'Query mail',
		description:
			'Run a read-only SQL query against the local Gmail mirror. Returns up to 1000 rows.',
		input: Type.Object({
			sql: Type.String({
				description: 'A read-only SQL SELECT over the local mirror.',
			}),
		}),
		tier: 'read',
		async run(ctx, args) {
			return queryMail({
				dbPath: dbPath(ctx.config.dataDir, ctx.accountEmail),
				sql: args.sql,
			});
		},
	}),
	defineMcpTool({
		name: 'status',
		title: 'Mail status',
		description:
			'Report the connected account, cursor state, and local mirror row counts.',
		input: Type.Object({}),
		tier: 'read',
		async run(ctx) {
			return Ok(
				await readMailStatus({
					config: ctx.config,
					accountEmail: ctx.accountEmail,
					store: ctx.store,
				}),
			);
		},
	}),
	defineMcpTool({
		name: 'sync',
		title: 'Refresh mail',
		description:
			'Refresh the local Gmail mirror. Incremental by default; pass full to force a complete re-pull. This only updates the local copy.',
		input: Type.Object({
			full: Type.Optional(
				Type.Boolean({
					description: 'Force a full re-pull instead of incremental history sync.',
				}),
			),
		}),
		tier: 'write',
		async run(ctx, args) {
			const token = await ctx.store.get(ctx.accountEmail);
			if (!token) {
				return Err({
					message: `No token stored for ${ctx.accountEmail}. Run "local-mail connect" first.`,
				});
			}
			const tokens = createTokenManager({
				config: ctx.config,
				store: ctx.store,
				token,
				now: ctx.now,
			});
			const client = createGmailClient({ config: ctx.config, tokens });
			const db = openMailDb(dbPath(ctx.config.dataDir, ctx.accountEmail));
			try {
				const outcome = await syncMailbox(
					{ db, client, config: ctx.config, now: ctx.now },
					{ forceFull: args.full ?? false },
				);
				if (outcome.failure) {
					return Err({
						message: `Sync failed (${outcome.failure.name}: ${outcome.failure.message}). The cursor did not advance.`,
					});
				}
				return Ok(outcome);
			} finally {
				db.close();
			}
		},
	}),
];

function toCallResult({ data, error }: ToolOutcome): CallToolResult {
	if (error) {
		return { content: [{ type: 'text', text: error.message }], isError: true };
	}
	return {
		content: [{ type: 'text', text: JSON.stringify(data) }],
		structuredContent: data as Record<string, unknown>,
	};
}

export async function runMcpServer(): Promise<number> {
	const config = loadConfig();
	const store = createFileTokenStore(config.credentialsPath);
	const now = () => Date.now();

	const server = new Server(
		{ name: 'local-mail', version: VERSION },
		{ capabilities: { tools: {} } },
	);

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: TOOLS.map((tool) => ({
			name: tool.name,
			title: tool.title,
			description: tool.description,
			inputSchema: tool.input,
			annotations: {
				readOnlyHint: tool.tier === 'read',
				destructiveHint: false,
			},
		})),
	}));

	server.setRequestHandler(CallToolRequestSchema, async (req) => {
		const tool = TOOLS.find((candidate) => candidate.name === req.params.name);
		if (!tool) {
			throw new McpError(
				ErrorCode.MethodNotFound,
				`Unknown tool: ${req.params.name}`,
			);
		}
		const callArgs: Record<string, unknown> = req.params.arguments ?? {};
		if (!Value.Check(tool.input, callArgs)) {
			const detail = Value.Errors(tool.input, callArgs)
				.map((error) => `${error.instancePath || '/'}: ${error.message}`)
				.join('; ');
			throw new McpError(
				ErrorCode.InvalidParams,
				`Invalid arguments for "${tool.name}": ${detail}`,
			);
		}
		const { data: accountEmail, error: accountError } = await resolveAccount(
			config,
			store,
		);
		if (accountError) {
			return {
				content: [{ type: 'text', text: accountError.message }],
				isError: true,
			};
		}
		const ctx: ToolContext = {
			config,
			accountEmail,
			store,
			now,
		};
		return toCallResult(await tool.run(ctx, callArgs));
	});

	const transport = new StdioServerTransport();
	const closed = new Promise<void>((resolve) => {
		server.onclose = () => resolve();
		process.stdin.once('end', resolve);
		process.stdin.once('close', resolve);
	});
	await server.connect(transport);
	await closed;
	return 0;
}
