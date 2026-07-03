/**
 * Board Projection Helper Tests
 *
 * Verifies the read-only board data shape built from classified in-memory rows.
 * The renderer consumes these columns directly, so this test guards the important
 * slice before Svelte markup gets involved.
 *
 * Key behaviors:
 * - Rows group by the board field after SQL stem ordering is applied.
 * - Declared card fields render by name and omit non-card fields.
 * - Missing group values land in the trailing Unassigned column.
 */

import { expect, test } from 'bun:test';
import {
	type Contract,
	classifyRows,
	type Row,
	type ViewSpec,
	validateContract,
} from '@epicenter/matter-core';
import { boardColumnsFor } from './board';

function contract(): Contract {
	const { data, error } = validateContract({
		fields: {
			title: { type: 'string' },
			status: { type: 'string', enum: ['todo', 'doing', 'done'] },
			platform: { type: 'string' },
		},
	});
	if (error) throw new Error(error.message);
	return data;
}

function row(fileName: string, frontmatter: Record<string, unknown>): Row {
	return { fileName, frontmatter, body: '' };
}

function field(model: Contract, name: string) {
	const match = model.fields.find((candidate) => candidate.name === name);
	if (!match) throw new Error(`Missing test field ${name}`);
	return match;
}

const board: ViewSpec = {
	id: 'pipeline',
	type: 'board',
	groupBy: 'status',
	columns: ['todo', 'doing', 'done'],
	card: ['title', 'platform'],
};

test('boardColumnsFor groups ordered in-memory rows and projects card fields', () => {
	const model = contract();
	const conformance = classifyRows(model.fields, [
		row('alpha.md', {
			title: 'Alpha',
			status: 'todo',
			platform: 'web',
		}),
		row('bravo.md', {
			title: 'Bravo',
			status: 'doing',
			platform: 'mobile',
		}),
		row('charlie.md', {
			title: 'Charlie',
			platform: 'email',
		}),
	]);

	const columns = boardColumnsFor({
		conformance,
		fields: model.fields,
		projection: board,
		orderedStems: ['bravo', 'alpha', 'charlie'],
	});

	expect(columns.map((column) => column.value)).toEqual([
		'todo',
		'doing',
		'done',
		null,
	]);
	expect(
		columns.map((column) => column.cards.map((card) => card.row.fileName)),
	).toEqual([['alpha.md'], ['bravo.md'], [], ['charlie.md']]);
	expect(columns[1]?.cards[0]?.fields).toEqual([
		{ field: field(model, 'title'), value: 'Bravo' },
		{ field: field(model, 'platform'), value: 'mobile' },
	]);
});

test('boardColumnsFor orders cards within a column by orderedStems', () => {
	const model = contract();
	const conformance = classifyRows(model.fields, [
		row('alpha.md', { title: 'Alpha', status: 'todo' }),
		row('bravo.md', { title: 'Bravo', status: 'todo' }),
		row('charlie.md', { title: 'Charlie', status: 'todo' }),
	]);

	// All three rows land in the same `todo` bucket, so the only thing that can
	// distinguish output is the stem order. Reverse the natural order to prove
	// orderedStems actually drives the card sequence rather than being a no-op.
	const columns = boardColumnsFor({
		conformance,
		fields: model.fields,
		projection: board,
		orderedStems: ['charlie', 'alpha', 'bravo'],
	});

	const todo = columns.find((column) => column.value === 'todo');
	expect(todo?.cards.map((card) => card.row.fileName)).toEqual([
		'charlie.md',
		'alpha.md',
		'bravo.md',
	]);
});

test('boardColumnsFor defaults to up to three non-group fields when card is omitted', () => {
	// A wider contract than the shared one: five fields so the fallback has to both
	// drop the groupBy field AND cap at three, proving the slice is not a no-op.
	const { data: model, error } = validateContract({
		fields: {
			title: { type: 'string' },
			status: { type: 'string', enum: ['todo', 'doing', 'done'] },
			platform: { type: 'string' },
			owner: { type: 'string' },
			priority: { type: 'string' },
		},
	});
	if (error) throw new Error(error.message);

	const conformance = classifyRows(model.fields, [
		row('alpha.md', {
			title: 'Alpha',
			status: 'todo',
			platform: 'web',
			owner: 'ada',
			priority: 'high',
		}),
	]);

	// No `card`, so the fallback picks every field except the `status` groupBy, in
	// contract order, capped at three: title, platform, owner. `priority` is dropped
	// by the cap even though it is a non-group field.
	const projection: ViewSpec = {
		id: 'default-cards',
		type: 'board',
		groupBy: 'status',
		columns: ['todo', 'doing', 'done'],
	};

	const columns = boardColumnsFor({
		conformance,
		fields: model.fields,
		projection,
	});

	const todo = columns.find((column) => column.value === 'todo');
	expect(todo?.cards[0]?.fields).toEqual([
		{ field: field(model, 'title'), value: 'Alpha' },
		{ field: field(model, 'platform'), value: 'web' },
		{ field: field(model, 'owner'), value: 'ada' },
	]);
});
