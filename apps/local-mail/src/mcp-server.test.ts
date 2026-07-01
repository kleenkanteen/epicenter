/**
 * Local Mail MCP Server Tests
 *
 * Drives `local-mail mcp` as a real subprocess over stdio JSON-RPC. The test
 * proves an MCP host can list tools, query mirrored body text, read status, and
 * receive protocol errors separately from tool-result errors.
 *
 * Key behaviors:
 * - stdout contains only JSON-RPC frames
 * - `query` returns body_text rows from a read-only db open
 * - `status` reports cursor and row counts
 * - malformed calls use the protocol error channel
 */

import { expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMailDb } from './db.ts';
import type { GmailMessage } from './schema.ts';

const BIN = join(import.meta.dir, 'bin.ts');
const ACCOUNT = 'you@example.com';

function tempDir() {
	const dir = mkdtempSync(join(tmpdir(), 'local-mail-mcp-test-'));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function base64Url(input: string): string {
	return Buffer.from(input, 'utf8')
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/g, '');
}

function seedMirror(dir: string): void {
	const message: GmailMessage = {
		id: 'm1',
		threadId: 't1',
		labelIds: ['INBOX'],
		snippet: 'Quarterly plan',
		internalDate: '1719000000000',
		payload: {
			headers: [
				{ name: 'Subject', value: 'Quarterly plan' },
				{ name: 'From', value: 'sender@example.com' },
			],
			parts: [
				{
					mimeType: 'text/plain',
					body: { data: base64Url('The launch budget is in this email body.') },
				},
			],
		},
	};
	const db = openMailDb(join(dir, ACCOUNT, 'mail.db'));
	db.ingestFullPullPage([message], '2026-07-01T00:00:00.000Z');
	db.ingestLabels([{ id: 'INBOX', name: 'INBOX', type: 'system' }], 's1');
	db.finishFullPull('1000', '2026-07-01T00:00:00.000Z');
	db.close();
}

type JsonRpcMessage = {
	jsonrpc: string;
	id?: number;
	result?: Record<string, unknown>;
	error?: { code: number; message: string };
};

function startMcp(env: Record<string, string>) {
	const proc = Bun.spawn([process.execPath, BIN, 'mcp'], {
		env: {
			...process.env,
			LOCAL_MAIL_DIR: '',
			LOCAL_MAIL_ACCOUNT: '',
			LOCAL_MAIL_TOKEN_FILE: '',
			...env,
		},
		stdin: 'pipe',
		stdout: 'pipe',
		stderr: 'pipe',
	});

	const pending = new Map<number, (msg: JsonRpcMessage) => void>();
	const stdoutLines: string[] = [];
	let nextId = 1;

	(async () => {
		const reader = proc.stdout.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			while (true) {
				const nl = buffer.indexOf('\n');
				if (nl === -1) break;
				const line = buffer.slice(0, nl).trim();
				buffer = buffer.slice(nl + 1);
				if (!line) continue;
				stdoutLines.push(line);
				let msg: JsonRpcMessage;
				try {
					msg = JSON.parse(line);
				} catch {
					continue;
				}
				if (typeof msg.id === 'number') pending.get(msg.id)?.(msg);
			}
		}
	})();

	const write = (obj: unknown) => {
		proc.stdin.write(`${JSON.stringify(obj)}\n`);
		proc.stdin.flush();
	};

	const request = (
		method: string,
		params?: unknown,
	): Promise<JsonRpcMessage> => {
		const id = nextId++;
		return new Promise<JsonRpcMessage>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(`timed out waiting for ${method}`)),
				4000,
			);
			pending.set(id, (msg) => {
				clearTimeout(timer);
				resolve(msg);
			});
			write({ jsonrpc: '2.0', id, method, params });
		});
	};

	return {
		request,
		notify: (method: string, params?: unknown) =>
			write({ jsonrpc: '2.0', method, params }),
		stdoutLines,
		stop: () => {
			proc.kill();
		},
	};
}

async function connect(env: Record<string, string>) {
	const mcp = startMcp(env);
	const init = await mcp.request('initialize', {
		protocolVersion: '2025-06-18',
		capabilities: {},
		clientInfo: { name: 'local-mail-test', version: '0.0.0' },
	});
	expect(init.result?.serverInfo).toMatchObject({ name: 'local-mail' });
	mcp.notify('notifications/initialized');
	return mcp;
}

test('mcp: tools/list, body query, status, errors, and a clean stream', async () => {
	const tmp = tempDir();
	seedMirror(tmp.dir);
	const mcp = await connect({
		LOCAL_MAIL_DIR: tmp.dir,
		LOCAL_MAIL_ACCOUNT: ACCOUNT,
	});

	const list = await mcp.request('tools/list');
	const tools = (list.result?.tools ?? []) as Array<{
		name: string;
		inputSchema: { type: string; properties?: Record<string, unknown> };
		annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
	}>;
	const names = tools.map((tool) => tool.name).sort();
	expect(names).toEqual(['query', 'status', 'sync']);
	const query = tools.find((tool) => tool.name === 'query');
	expect(query?.inputSchema.properties).toHaveProperty('sql');
	expect(query?.annotations?.readOnlyHint).toBe(true);
	const sync = tools.find((tool) => tool.name === 'sync');
	expect(sync?.annotations?.readOnlyHint).toBe(false);
	expect(sync?.annotations?.destructiveHint).toBe(false);

	const ok = await mcp.request('tools/call', {
		name: 'query',
		arguments: {
			sql: "SELECT subject, body_text FROM messages WHERE body_text LIKE '%launch budget%'",
		},
	});
	expect(ok.result?.isError).toBeFalsy();
	const data = ok.result?.structuredContent as {
		rows: Array<{ subject: string; body_text: string }>;
		rowCount: number;
	};
	expect(data.rowCount).toBe(1);
	expect(data.rows[0]?.body_text).toContain('launch budget');

	const status = await mcp.request('tools/call', {
		name: 'status',
		arguments: {},
	});
	const statusData = status.result?.structuredContent as {
		accountEmail: string;
		historyId: string;
		rows: { messages: number; labels: number };
	};
	expect(statusData.accountEmail).toBe(ACCOUNT);
	expect(statusData.historyId).toBe('1000');
	expect(statusData.rows).toEqual({ messages: 1, labels: 1 });

	const syncWithoutToken = await mcp.request('tools/call', {
		name: 'sync',
		arguments: {},
	});
	expect(syncWithoutToken.error).toBeUndefined();
	expect(syncWithoutToken.result?.isError).toBe(true);

	const unknown = await mcp.request('tools/call', {
		name: 'does_not_exist',
		arguments: {},
	});
	expect(unknown.error?.code).toBe(-32601);

	const badSql = await mcp.request('tools/call', {
		name: 'query',
		arguments: { sql: 'SELECT * FROM missing_table' },
	});
	expect(badSql.error).toBeUndefined();
	expect(badSql.result?.isError).toBe(true);

	const badArgs = await mcp.request('tools/call', {
		name: 'query',
		arguments: { sql: 123 },
	});
	expect(badArgs.error?.code).toBe(-32602);

	for (const line of mcp.stdoutLines) {
		const parsed = JSON.parse(line);
		expect(parsed.jsonrpc).toBe('2.0');
	}

	mcp.stop();
	tmp.cleanup();
});
