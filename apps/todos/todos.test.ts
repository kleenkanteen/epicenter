/**
 * Todos Workspace Tests
 *
 * Verifies todo domain behavior across the workspace actions.
 *
 * Key behaviors:
 * - Contexts are a fixed set of built-in slugs; todos carry a subset of them
 * - Unknown context slugs are rejected on the create path
 * - Due dates round-trip, and todos complete and soft-delete through actions
 */
import { describe, expect, test } from 'bun:test';
import type { CalendarDateString } from '@epicenter/field';
import { BUILT_IN_CONTEXTS, type ContextSlug, todosWorkspace } from './todos';

function createTestTodos() {
	return todosWorkspace.create();
}

describe('context slugs', () => {
	test('a todo carries built-in context slugs', () => {
		const todos = createTestTodos();
		const id = todos.actions.todos_create({
			title: 'Call back',
			contexts: ['phone', 'desk'],
		});

		expect(todos.tables.todos.get(id).data?.contexts).toEqual([
			'phone',
			'desk',
		]);
	});

	test('rejects unknown context slugs', () => {
		const todos = createTestTodos();
		expect(() =>
			todos.actions.todos_create({
				title: 'Nope',
				contexts: ['weekend'] as ContextSlug[],
			}),
		).toThrow();
	});

	test('dedupes repeated context slugs', () => {
		const todos = createTestTodos();
		const id = todos.actions.todos_create({
			title: 'Dup',
			contexts: ['phone', 'phone'],
		});

		expect(todos.tables.todos.get(id).data?.contexts).toEqual(['phone']);
	});
});

describe('due dates', () => {
	test('a todo has no due date by default', () => {
		const todos = createTestTodos();
		const id = todos.actions.todos_create({ title: 'Someday' });
		expect(todos.tables.todos.get(id).data?.dueDate).toBeNull();
	});

	test('an all-day due date round-trips through create', () => {
		const todos = createTestTodos();
		const id = todos.actions.todos_create({
			title: 'Pay rent',
			dueDate: '2026-07-01' as CalendarDateString,
		});
		expect(todos.tables.todos.get(id).data?.dueDate).toBe('2026-07-01');
	});
});

describe('todo write path', () => {
	test('creates, completes, and soft-deletes a todo through actions', () => {
		const todos = createTestTodos();

		const id = todos.actions.todos_create({
			title: 'Reply from mobile',
			contexts: ['phone'],
		});
		const created = todos.tables.todos.get(id).data;
		expect(created?.title).toBe('Reply from mobile');
		expect(created?.contexts).toEqual(['phone']);
		expect(created?.completedAt).toBeNull();

		todos.actions.todos_set_completed({ id, completed: true });
		expect(todos.tables.todos.get(id).data?.completedAt).not.toBeNull();

		todos.actions.todos_delete({ id });
		expect(todos.tables.todos.get(id).data?.deletedAt).not.toBeNull();
	});

	test('lists visible todos and excludes soft-deleted rows', () => {
		const todos = createTestTodos();

		const kept = todos.actions.todos_create({ title: 'Keep' });
		const deleted = todos.actions.todos_create({ title: 'Hide' });
		todos.actions.todos_delete({ id: deleted });

		expect(todos.actions.todos_list()).toEqual([
			expect.objectContaining({ id: kept, title: 'Keep' }),
		]);
	});
});

describe('built-in contexts', () => {
	test('are the fixed set of contexts, distinct and code-defined', () => {
		expect(BUILT_IN_CONTEXTS.map((context) => context.id)).toEqual([
			'phone',
			'computer',
			'desk',
		]);
		const colors = BUILT_IN_CONTEXTS.map((context) => context.color);
		expect(new Set(colors).size).toBe(colors.length);
	});
});
