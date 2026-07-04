/**
 * Sheet reorder helpers, keyed by a fractional `order` string.
 */

import type * as Y from 'yjs';

/**
 * Compute a fractional index between two bounds. Adds small jitter to prevent
 * collisions on concurrent reorders.
 *
 * Caveat: float bisection loses precision after ~50 inserts between the same
 * neighbors (duplicate order values). This body has no non-test consumer, so
 * it is deletion-bound and not worth investing in; if a real sheet surface
 * ever ships, replace it with a string-keyed fractional index (ADR-0106).
 *
 * @param start - Lower bound (exclusive)
 * @param end - Upper bound (exclusive)
 * @returns A number strictly between start and end
 */
function computeMidpoint(start: number, end: number): number {
	const mid = (start + end) / 2;
	const range = (end - start) * 1e-10;
	const jitter = -range / 2 + Math.random() * range;
	return mid + jitter;
}

/**
 * Reorder a row by updating its fractional order property.
 */
export function reorderRow(
	rows: Y.Map<Y.Map<string>>,
	rowId: string,
	beforeOrder: number,
	afterOrder: number,
): void {
	const rowMap = rows.get(rowId);
	if (!rowMap) return;
	rowMap.set('order', String(computeMidpoint(beforeOrder, afterOrder)));
}

/**
 * Reorder a column by updating its fractional order property.
 */
export function reorderColumn(
	columns: Y.Map<Y.Map<string>>,
	colId: string,
	beforeOrder: number,
	afterOrder: number,
): void {
	const colMap = columns.get(colId);
	if (!colMap) return;
	colMap.set('order', String(computeMidpoint(beforeOrder, afterOrder)));
}
