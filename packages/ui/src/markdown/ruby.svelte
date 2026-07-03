<!--
	One romanizer segment. A segment with a reading becomes a native <ruby> (with
	<rp> parens as the fallback for browsers without ruby support, and for clean
	copy/paste); one without passes its text through. Real DOM nodes, never an
	HTML string, so nothing needs sanitizing.

	A segment carrying a `term` (its containing tappable capture unit), with an
	`onTermTap` handler supplied, wraps the same ruby/text output in an inline
	button that reports the tap; a segment without one (or no handler) renders
	exactly as before.

	The whole thing is one line so no template whitespace lands between adjacent
	segments, which would split CJK runs (你好 must not render as 你 好).
-->
<script lang="ts">
	import type { Segment } from './romanizer.js';

	let {
		segment,
		onTermTap,
		termActionLabel = 'Use term',
	}: {
		segment: Segment;
		onTermTap?: (term: string) => void;
		termActionLabel?: string;
	} = $props();

	const TAP_BUTTON_CLASS =
		'appearance-none border-0 bg-transparent p-0 m-0 text-inherit align-baseline cursor-pointer rounded-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none';
</script>

{#if segment.term && onTermTap}<button type="button" class={TAP_BUTTON_CLASS} title={termActionLabel} aria-label={termActionLabel} onclick={() => { if (segment.term && onTermTap) onTermTap(segment.term); }}>{#if segment.reading}<ruby>{segment.text}<rp>(</rp><rt>{segment.reading}</rt><rp>)</rp></ruby>{:else}{segment.text}{/if}</button>{:else if segment.reading}<ruby>{segment.text}<rp>(</rp><rt>{segment.reading}</rt><rp>)</rp></ruby>{:else}{segment.text}{/if}
