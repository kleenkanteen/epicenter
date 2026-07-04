/**
 * Timeline Tests
 *
 * Validates the single-layout (text) timeline body: read/write in place,
 * append, empty-timeline seeding via asText, observation, and the key
 * parameter. Entry count is asserted against the durable `Y.Array` directly,
 * since the handle exposes no count accessor.
 */

import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { attachTimeline } from './attach-timeline.js';

function setup(key = 'timeline') {
	const ydoc = new Y.Doc();
	return { ydoc, tl: attachTimeline(ydoc, key), key };
}

/** Number of entries in the durable timeline array. */
function entryCount(ydoc: Y.Doc, key = 'timeline'): number {
	return ydoc.getArray(key).length;
}

describe('attachTimeline - read/write', () => {
	test('read on empty timeline returns empty string', () => {
		const { ydoc, tl } = setup();
		expect(tl.read()).toBe('');
		expect(entryCount(ydoc)).toBe(0);
	});

	test('write on empty timeline creates a text entry', () => {
		const { ydoc, tl } = setup();
		tl.write('hello');
		expect(tl.read()).toBe('hello');
		expect(entryCount(ydoc)).toBe(1);
	});

	test('write replaces content in place (entry count unchanged)', () => {
		const { ydoc, tl } = setup();
		tl.write('first');
		expect(entryCount(ydoc)).toBe(1);
		tl.write('second');
		expect(entryCount(ydoc)).toBe(1);
		expect(tl.read()).toBe('second');
	});

	test('the stored entry is a text entry holding a Y.Text', () => {
		const { ydoc, tl } = setup();
		tl.write('hi');
		const entry = ydoc.getArray<Y.Map<unknown>>('timeline').get(0);
		expect(entry.get('type')).toBe('text');
		expect(entry.get('content')).toBeInstanceOf(Y.Text);
		expect((entry.get('content') as Y.Text).toString()).toBe('hi');
	});
});

describe('attachTimeline - asText', () => {
	test('asText on empty timeline pushes an empty text entry', () => {
		const { ydoc, tl } = setup();
		const ytext = tl.asText();
		expect(ytext).toBeInstanceOf(Y.Text);
		expect(ytext.toString()).toBe('');
		expect(entryCount(ydoc)).toBe(1);
	});

	test('asText returns the existing Y.Text without a new entry', () => {
		const { ydoc, tl } = setup();
		tl.write('seed');
		const ytext = tl.asText();
		expect(ytext.toString()).toBe('seed');
		expect(entryCount(ydoc)).toBe(1);
		// Same underlying Y.Text: edits are reflected by read().
		ytext.insert(ytext.length, '!');
		expect(tl.read()).toBe('seed!');
	});
});

describe('attachTimeline - appendText', () => {
	test('appendText on empty timeline creates a text entry', () => {
		const { ydoc, tl } = setup();
		tl.appendText('hello');
		expect(tl.read()).toBe('hello');
		expect(entryCount(ydoc)).toBe(1);
	});

	test('appendText on existing text appends without a new entry', () => {
		const { ydoc, tl } = setup();
		tl.write('hello');
		expect(entryCount(ydoc)).toBe(1);
		tl.appendText(' world');
		expect(tl.read()).toBe('hello world');
		expect(entryCount(ydoc)).toBe(1);
	});

	test('multiple appendText calls accumulate content', () => {
		const { ydoc, tl } = setup();
		tl.appendText('a');
		tl.appendText('b');
		tl.appendText('c');
		expect(tl.read()).toBe('abc');
		expect(entryCount(ydoc)).toBe(1);
	});
});

describe('attachTimeline - observe', () => {
	test('fires when a new entry is pushed via write()', () => {
		const { tl } = setup();
		let calls = 0;
		tl.observe(() => calls++);
		tl.write('one');
		expect(calls).toBe(1);
	});

	test('does NOT fire when write replaces text in-place', () => {
		const { tl } = setup();
		tl.write('one');
		let calls = 0;
		tl.observe(() => calls++);
		tl.write('two'); // in-place, no structural change
		expect(calls).toBe(0);
	});

	test('does NOT fire when content within an existing entry changes', () => {
		const { tl } = setup();
		const ytext = tl.asText();
		let calls = 0;
		tl.observe(() => calls++);
		ytext.insert(ytext.length, 'x');
		expect(calls).toBe(0);
	});

	test('unsubscribe stops notifications', () => {
		const { tl } = setup();
		let calls = 0;
		const unsubscribe = tl.observe(() => calls++);
		tl.write('one');
		unsubscribe();
		tl.appendText(' two'); // in-place; would not fire anyway
		expect(calls).toBe(1);
	});
});

describe('attachTimeline - key parameter', () => {
	test('default key is "timeline"', () => {
		const { ydoc, tl } = setup();
		tl.write('seed');
		expect(ydoc.getArray('timeline').length).toBe(1);
	});

	test('custom key reserves a different Y.Array slot', () => {
		const { ydoc, tl } = setup('log');
		tl.write('seed');
		expect(ydoc.getArray('log').length).toBe(1);
		// The default 'timeline' slot is untouched.
		expect(ydoc.getArray('timeline').length).toBe(0);
	});

	test('two timelines on the same doc with different keys are independent', () => {
		const ydoc = new Y.Doc();
		const a = attachTimeline(ydoc, 'a');
		const b = attachTimeline(ydoc, 'b');

		a.write('in a');
		b.write('in b');

		expect(a.read()).toBe('in a');
		expect(b.read()).toBe('in b');
	});

	test('repeat attach on same (ydoc, key) reads the same underlying state', () => {
		const ydoc = new Y.Doc();
		const first = attachTimeline(ydoc, 'shared');
		first.write('hello');

		const second = attachTimeline(ydoc, 'shared');
		expect(second.read()).toBe('hello');
	});
});
