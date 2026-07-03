import {
	type ContractField,
	groupRowsByField,
	type Row,
	type RowConformance,
	stemOf,
	type ViewSpec,
} from '@epicenter/matter-core';

export type BoardCardField = {
	field: ContractField;
	value: unknown;
};

export type BoardCard = {
	row: Row;
	fields: BoardCardField[];
};

export type BoardColumn = {
	value: string | null;
	cards: BoardCard[];
};

export type BoardDropEdit = {
	fileName: string;
	key: string;
	value: string | undefined;
};

export function canWriteBoardColumn(
	groupByField: ContractField,
	columnValue: string | null,
): boolean {
	return columnValue === null || groupByField.check(columnValue);
}

function orderedConformance(
	conformance: readonly RowConformance[],
	orderedStems: readonly string[] | undefined,
): RowConformance[] {
	if (!orderedStems) return [...conformance];
	const byStem = new Map(
		conformance.map((entry) => [stemOf(entry.row.fileName), entry]),
	);
	return orderedStems.flatMap((stem) => {
		const entry = byStem.get(stem);
		return entry ? [entry] : [];
	});
}

function cardFieldsFor(
	projection: ViewSpec,
	fields: readonly ContractField[],
): ContractField[] {
	if (projection.card) {
		const byName = new Map(fields.map((field) => [field.name, field]));
		return projection.card.flatMap((name) => {
			const field = byName.get(name);
			return field ? [field] : [];
		});
	}
	return fields
		.filter((field) => field.name !== projection.groupBy)
		.slice(0, 3);
}

export function boardColumnsFor({
	conformance,
	fields,
	projection,
	orderedStems,
}: {
	conformance: readonly RowConformance[];
	fields: readonly ContractField[];
	projection: ViewSpec;
	orderedStems?: readonly string[];
}): BoardColumn[] {
	const ordered = orderedConformance(conformance, orderedStems);
	const cardFields = cardFieldsFor(projection, fields);
	const buckets = groupRowsByField(
		ordered.map((entry) => entry.row),
		projection.groupBy,
		projection.columns ?? [],
	);
	return buckets.map((bucket) => ({
		value: bucket.value,
		cards: bucket.rows.map((row) => ({
			row,
			fields: cardFields.map((field) => ({
				field,
				value: row.frontmatter[field.name],
			})),
		})),
	}));
}

export function boardDropEditFor({
	fileName,
	groupByField,
	columnValue,
}: {
	fileName: string;
	groupByField: ContractField;
	columnValue: string | null;
}): BoardDropEdit | null {
	if (columnValue === null) {
		return {
			fileName,
			key: groupByField.name,
			value: undefined,
		};
	}
	if (!canWriteBoardColumn(groupByField, columnValue)) return null;
	return {
		fileName,
		key: groupByField.name,
		value: columnValue,
	};
}
