<script lang="ts">
	import { Button } from '@epicenter/ui/button';
	import { sanitizeEmailHtml } from '$lib/sanitize-email';

	let {
		unsafeHtml,
		text,
	}: {
		/** The raw `text/html` body from the read model, unsanitized. This
		 * component is the only place it may render: it passes through
		 * `sanitizeEmailHtml` before the single `{@html}` sink below. */
		unsafeHtml: string | null;
		/** The extracted plain-text body, the fallback and the "Plain text" view. */
		text: string | null;
	} = $props();

	// Sanitize once per body. This derived value is the ONLY string in the app
	// allowed to reach `{@html}`; email HTML is hostile, so it never renders raw.
	const safeHtml = $derived(unsafeHtml ? sanitizeEmailHtml(unsafeHtml) : null);

	// A per-message view choice, local state only, not a persisted preference.
	// The shown view is the user's pick if they made one, else the natural
	// default: the formatted body when the message has one, plain text otherwise.
	// The parent remounts this per message via `{#key}`, so the choice resets.
	let userView = $state<'formatted' | 'plain' | null>(null);
	const view = $derived(userView ?? (safeHtml ? 'formatted' : 'plain'));

	// The toggle only earns its place when both views exist; with only one body
	// there is nothing to switch to. Formatted is primary and plain text is the
	// escape hatch, so this is one secondary button, not a segmented control.
	const canToggle = $derived(safeHtml !== null && text !== null);
</script>

<div class="flex min-h-0 flex-1 flex-col">
	{#if canToggle}
		<div class="flex shrink-0 justify-end px-5 pt-3">
			<Button
				variant="ghost"
				size="sm"
				class="text-xs text-muted-foreground"
				onclick={() => (userView = view === 'formatted' ? 'plain' : 'formatted')}
			>
				{view === 'formatted' ? 'View as plain text' : 'View formatted'}
			</Button>
		</div>
	{/if}

	<div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
		{#if safeHtml && view === 'formatted'}
			<!-- A formatted email is a foreign document that assumes a light canvas,
			     so it renders on its own bounded white sheet rather than inheriting
			     the app's dark theme. `color-scheme: light` keeps inherited/default
			     colors readable; the sanitizer already stripped remote assets. -->
			<div
				class="email-canvas mx-auto max-w-[640px] rounded-lg border border-border bg-white px-6 py-5 text-neutral-900 [color-scheme:light]"
			>
				<!-- The single `{@html}` site in the app. `safeHtml` is DOMPurify
				     output; remote assets are stripped and links open in a new tab. -->
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html safeHtml}
			</div>
		{:else if text}
			<pre class="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground/90">{text}</pre>
		{:else}
			<p class="text-sm italic text-muted-foreground">
				No readable body for this message.
			</p>
		{/if}
	</div>
</div>

<style>
	/* Keep hostile email markup inside its lane: cap media/table width so a wide
	   layout cannot force the sheet (or the app) to scroll horizontally. Not
	   fidelity styling, just containment. */
	.email-canvas :global(img),
	.email-canvas :global(table) {
		max-width: 100%;
	}
	.email-canvas :global(a) {
		text-decoration: underline;
	}
</style>
