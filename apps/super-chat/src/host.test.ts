/**
 * Super Chat Host Tests
 *
 * Verifies that the host composes built-in app actions, optional Local Books
 * MCP tools, and one durable local replica set into a single conversation
 * surface.
 *
 * Key behaviors:
 * - Built-in app actions are namespaced and callable through the catalog.
 * - Local Books MCP failures stay on the external-tool path.
 * - Host-local app replicas survive process restart through Bun persistence.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
	AgentEngine,
	AgentMessagePart,
	Approval,
	EngineChunk,
} from '@epicenter/workspace/agent';
import { createSuperChatHost, type SuperChatHostOptions } from './host.ts';

const FIXTURE = new URL('../test-fixtures/mini-mcp-server.ts', import.meta.url)
	.pathname;

/**
 * A scripted engine: each model call consumes the next chunk list. The last
 * script repeats, so a trailing text answer also serves any extra step.
 */
function scriptedEngine(scripts: EngineChunk[][]): AgentEngine {
	let step = 0;
	return async function* () {
		const script = scripts[Math.min(step, scripts.length - 1)] ?? [];
		step += 1;
		for (const chunk of script) yield chunk;
	};
}

/** Auto-approve everything: the smoke tests exercise gated mutations headless. */
const APPROVE_ALL: Approval = {
	decide: () => 'auto',
	request: async () => true,
};

function testDataDir(): string {
	return mkdtempSync(join(tmpdir(), 'super-chat-host-test-'));
}

function createTestHost(options: Omit<SuperChatHostOptions, 'dataDir'>) {
	return createSuperChatHost({ dataDir: testDataDir(), ...options });
}

async function settle(host: {
	conversation: { snapshot(): { isGenerating: boolean } };
}) {
	for (let i = 0; i < 500 && host.conversation.snapshot().isGenerating; i++) {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

async function waitFor(
	predicate: () => boolean,
	description: string,
): Promise<void> {
	for (let i = 0; i < 500; i++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error(`Timed out waiting for ${description}`);
}

function toolResults(parts: AgentMessagePart[]) {
	return parts.filter((part) => part.type === 'tool-result');
}

describe('createSuperChatHost', () => {
	test('composes the in-process apps under namespaced verbs', async () => {
		await using host = await createTestHost({
			engine: scriptedEngine([[]]),
		});
		const names = host.tools.definitions().map((d) => d.name);
		expect(names).toContain('todos__todos_create');
		expect(names).toContain('todos__todos_list');
		expect(names).toContain('honeycrisp__folders_delete');
	});

	test('one chat turn drives an in-process verb end to end', async () => {
		const engine = scriptedEngine([
			[
				{
					type: 'tool-call',
					toolCallId: 'call-1',
					toolName: 'todos__todos_create',
					input: { title: 'Buy milk' },
				},
			],
			[{ type: 'text-delta', delta: 'Created your todo.' }],
		]);
		await using host = await createTestHost({
			engine,
			approval: APPROVE_ALL,
		});

		host.conversation.send('add buy milk to my todos');
		await settle(host);

		const { messages, error } = host.conversation.snapshot();
		expect(error).toBeNull();
		const results = messages.flatMap((m) => toolResults(m.parts));
		expect(results).toHaveLength(1);
		expect(results[0]!.isError).toBe(false);
		// todos_create returns the created TodoId: proof the verb ran in-process.
		expect(typeof results[0]!.content).toBe('string');
		expect(messages.at(-1)!.parts).toContainEqual({
			type: 'text',
			text: 'Created your todo.',
		});
	});

	test('host-owned approval prompt gates a mutation and approval resumes the turn', async () => {
		const engine = scriptedEngine([
			[
				{
					type: 'tool-call',
					toolCallId: 'call-1',
					toolName: 'todos__todos_create',
					input: { title: 'Needs approval' },
				},
			],
			[{ type: 'text-delta', delta: 'Created after approval.' }],
		]);
		await using host = await createTestHost({ engine });

		expect(host.handleCommand({ type: 'send', content: 'add a todo' })).toBe(
			true,
		);
		await waitFor(
			() => host.snapshot().pendingApprovals.length === 1,
			'a pending approval',
		);

		const [approval] = host.snapshot().pendingApprovals;
		expect(approval).toEqual(
			expect.objectContaining({
				toolCallId: 'call-1',
				toolName: 'todos__todos_create',
				input: { title: 'Needs approval' },
			}),
		);

		expect(
			host.handleCommand({
				type: 'approve',
				requestId: approval!.id,
				approved: true,
			}),
		).toBe(true);
		await settle(host);

		const { messages, error } = host.conversation.snapshot();
		expect(error).toBeNull();
		expect(host.snapshot().pendingApprovals).toEqual([]);
		const results = messages.flatMap((m) => toolResults(m.parts));
		expect(results).toHaveLength(1);
		expect(results[0]!.isError).toBe(false);
		expect(host.snapshot().activity).toEqual([
			expect.objectContaining({
				type: 'approval-requested',
				requestId: approval!.id,
				toolName: 'todos__todos_create',
			}),
			expect.objectContaining({
				type: 'approval-resolved',
				requestId: approval!.id,
				toolName: 'todos__todos_create',
				approved: true,
			}),
		]);
		expect(messages.at(-1)!.parts).toContainEqual({
			type: 'text',
			text: 'Created after approval.',
		});
	});

	test('always allow approves the next matching mutation without a second prompt', async () => {
		const engine = scriptedEngine([
			[
				{
					type: 'tool-call',
					toolCallId: 'call-1',
					toolName: 'todos__todos_create',
					input: { title: 'First' },
				},
			],
			[{ type: 'text-delta', delta: 'Created first.' }],
			[
				{
					type: 'tool-call',
					toolCallId: 'call-2',
					toolName: 'todos__todos_create',
					input: { title: 'Second' },
				},
			],
			[{ type: 'text-delta', delta: 'Created second.' }],
		]);
		await using host = await createTestHost({ engine });

		host.handleCommand({ type: 'send', content: 'add first' });
		await waitFor(
			() => host.snapshot().pendingApprovals.length === 1,
			'the first approval',
		);
		const [approval] = host.snapshot().pendingApprovals;
		host.handleCommand({
			type: 'approve',
			requestId: approval!.id,
			approved: true,
			alwaysAllowSession: true,
		});
		await settle(host);

		host.handleCommand({ type: 'send', content: 'add second' });
		await settle(host);

		expect(host.snapshot().pendingApprovals).toEqual([]);
		const results = host.conversation
			.snapshot()
			.messages.flatMap((m) => toolResults(m.parts));
		expect(results).toHaveLength(2);
		expect(results.every((result) => result.isError === false)).toBe(true);
	});

	test('a subprocess that never speaks MCP fails host creation fast', async () => {
		// Without the catalog's own connect timeout this would ride the SDK's
		// minute-long per-request default and the host would look wedged.
		await expect(
			createTestHost({
				engine: scriptedEngine([[]]),
				localBooks: {
					command: 'bun',
					args: ['-e', 'await new Promise(() => {})'],
					connectTimeoutMs: 300,
				},
			}),
		).rejects.toThrow(/timeout \(300ms\)/);
	});

	test('a stdio MCP subprocess joins the same composed surface', async () => {
		const engine = scriptedEngine([
			[
				{
					type: 'tool-call',
					toolCallId: 'call-1',
					toolName: 'localbooks__customers',
					input: {},
				},
			],
			[{ type: 'text-delta', delta: 'Acme owes the most.' }],
		]);
		await using host = await createTestHost({
			engine,
			localBooks: { command: 'bun', args: [FIXTURE] },
		});

		// The read-only hint projects to a `query`, so no approval is needed.
		const customers = host.tools
			.definitions()
			.find((d) => d.name === 'localbooks__customers');
		expect(customers?.kind).toBe('query');

		host.conversation.send('who owes me money?');
		await settle(host);

		const { messages, error } = host.conversation.snapshot();
		expect(error).toBeNull();
		const results = messages.flatMap((m) => toolResults(m.parts));
		expect(results).toHaveLength(1);
		expect(results[0]!.isError).toBe(false);
		expect(results[0]!.content).toContain('Acme | 4200.00');
	});

	test('a second host over the same data dir reads the first host todos through the catalog', async () => {
		const dataDir = testDataDir();
		{
			await using host = await createSuperChatHost({
				dataDir,
				engine: scriptedEngine([[]]),
				approval: APPROVE_ALL,
			});
			const result = await host.tools.resolve(
				{
					toolCallId: 'call-create',
					toolName: 'todos__todos_create',
					input: { title: 'Survives restart' },
				},
				new AbortController().signal,
			);
			expect(result.isError).toBe(false);
		}

		await using host = await createSuperChatHost({
			dataDir,
			engine: scriptedEngine([[]]),
		});
		const result = await host.tools.resolve(
			{
				toolCallId: 'call-list',
				toolName: 'todos__todos_list',
				input: {},
			},
			new AbortController().signal,
		);
		expect(result.isError).toBe(false);
		expect(result.details).toContainEqual(
			expect.objectContaining({ title: 'Survives restart' }),
		);
	});
});
