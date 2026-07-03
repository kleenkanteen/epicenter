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
