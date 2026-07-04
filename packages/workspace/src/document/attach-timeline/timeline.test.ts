/**
 * Timeline Tests
 *
 * Validates the single-layout (text) timeline body: read/write in place,
 * append, empty-timeline seeding via asText, batching, observation, and the
 * key parameter.
 */

import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { attachTimeline } from './timeline.js';

function setup() {
	return attachTimeline(new Y.Doc());
}

describe('attachTimeline - read/write', () => {
	test('read on empty timeline returns empty string', () => {
		const tl = setup();
		expect(tl.read()).toBe('');
		expect(tl.length).toBe(0);
	});

	test('write on empty timeline creates a text entry', () => {
		const tl = setup();
		tl.write('hello');
		expect(tl.read()).toBe('hello');
		expect(tl.length).toBe(1);
		expect(tl.currentEntry?.type).toBe('text');
	});

	test('write replaces content in place (length unchanged)', () => {
		const tl = setup();
		tl.write('first');
		expect(tl.length).toBe(1);
		tl.write('second');
		expect(tl.length).toBe(1);
		expect(tl.read()).toBe('second');
	});

	test('currentEntry exposes the stored Y.Text and createdAt', () => {
		const tl = setup();
		tl.write('hi');
		const entry = tl.currentEntry;
		expect(entry?.content).toBeInstanceOf(Y.Text);
		expect(entry?.content.toString()).toBe('hi');
		expect(typeof entry?.createdAt).toBe('number');
	});
});

describe('attachTimeline - asText', () => {
	test('asText on empty timeline pushes an empty text entry', () => {
		const tl = setup();
		const ytext = tl.asText();
		expect(ytext).toBeInstanceOf(Y.Text);
		expect(ytext.toString()).toBe('');
		expect(tl.length).toBe(1);
		expect(tl.currentEntry?.type).toBe('text');
	});

	test('asText returns the existing Y.Text without a new entry', () => {
		const tl = setup();
		tl.write('seed');
		const before = tl.length;
		const ytext = tl.asText();
		expect(ytext.toString()).toBe('seed');
		expect(tl.length).toBe(before);
		// Same underlying Y.Text: edits are reflected by read().
		ytext.insert(ytext.length, '!');
		expect(tl.read()).toBe('seed!');
	});
});

describe('attachTimeline - appendText', () => {
	test('appendText on empty timeline creates a text entry', () => {
		const tl = setup();
		tl.appendText('hello');
		expect(tl.currentEntry?.type).toBe('text');
		expect(tl.read()).toBe('hello');
		expect(tl.length).toBe(1);
	});

	test('appendText on existing text appends without a new entry', () => {
		const tl = setup();
		tl.write('hello');
		expect(tl.length).toBe(1);
		tl.appendText(' world');
		expect(tl.read()).toBe('hello world');
		expect(tl.length).toBe(1);
	});

	test('multiple appendText calls accumulate content', () => {
		const tl = setup();
		tl.appendText('a');
		tl.appendText('b');
		tl.appendText('c');
		expect(tl.read()).toBe('abc');
		expect(tl.length).toBe(1);
	});
});

describe('attachTimeline - batch', () => {
	test('two writes in one batch trigger observe once', () => {
		const tl = setup();
		let callCount = 0;
		tl.observe(() => callCount++);
		// First write pushes text entry, second replaces in-place.
		// Yjs collapses nested transactions. Single observe callback.
		tl.batch(() => {
			tl.write('first');
			tl.write('second');
		});
		expect(callCount).toBe(1);
		expect(tl.read()).toBe('second');
	});

	test('batch does not affect read/write correctness', () => {
		const tl = setup();
		tl.batch(() => {
			tl.write('hello');
			expect(tl.read()).toBe('hello');
			tl.write('world');
			expect(tl.read()).toBe('world');
		});
		expect(tl.read()).toBe('world');
	});
});

describe('attachTimeline - observe', () => {
	test('fires when a new entry is pushed via write()', () => {
		const tl = setup();
		let calls = 0;
		tl.observe(() => calls++);
		tl.write('one');
		expect(calls).toBe(1);
	});

	test('does NOT fire when write replaces text in-place', () => {
		const tl = setup();
		tl.write('one');
		let calls = 0;
		tl.observe(() => calls++);
		tl.write('two'); // in-place, no structural change
		expect(calls).toBe(0);
	});

	test('does NOT fire when content within an existing entry changes', () => {
		const tl = setup();
		const ytext = tl.asText();
		let calls = 0;
		tl.observe(() => calls++);
		ytext.insert(ytext.length, 'x');
		expect(calls).toBe(0);
	});

	test('unsubscribe stops notifications', () => {
		const tl = setup();
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
		const ydoc = new Y.Doc();
		const tl = attachTimeline(ydoc);
		tl.write('seed');

		// The default timeline array is reachable at key 'timeline'.
		expect(ydoc.getArray('timeline').length).toBe(1);
	});

	test('custom key reserves a different Y.Array slot', () => {
		const ydoc = new Y.Doc();
		const tl = attachTimeline(ydoc, 'log');
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
