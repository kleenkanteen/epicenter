<script lang="ts">
	import {
		AgentChatThread,
		type ConversationHandle,
	} from '@epicenter/app-shell/agent-chat';
	import { complete } from '@epicenter/client';
	import { Button } from '@epicenter/ui/button';
	import { agentMessageText } from '@epicenter/workspace/agent';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { buildHarvestPrompt, parseHarvestCandidates } from '$lib/harvest';
	import { auth } from '$lib/platform/auth';
	import { inferenceConnections } from '$lib/state/inference-connections.svelte';
	import { termsState } from '$lib/state/terms.svelte';
	import DictationButton from './DictationButton.svelte';
	import ReadingMarkdown from './ReadingMarkdown.svelte';

	let {
		active,
		showReadings,
	}: { active: ConversationHandle | undefined; showReadings: boolean } = $props();

	// `active` does not narrow inside a snippet closure (a snippet can outlive the
	// `{#if active}` guard), so the input accessory reads these instead of the
	// handle directly.
	const isGenerating = $derived(active?.isLoading ?? false);

	let saveAffordance = $state<{ text: string; x: number; y: number } | null>(
		null,
	);

	/** The selection's text with ruby annotations stripped: `toString()` would
	 * include the reading `<rt>`/`<rp>` nodes, so selecting a word with readings
	 * shown would capture the reading too instead of the verbatim characters. */
	function selectedTermText(selection: Selection): string {
		const fragment = selection.getRangeAt(0).cloneContents();
		for (const annotation of fragment.querySelectorAll('rt, rp')) {
			annotation.remove();
		}
		return fragment.textContent?.trim() ?? '';
	}

	function handleSelectionChange() {
		const selection = document.getSelection();
		if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
			saveAffordance = null;
			return;
		}

		const text = selectedTermText(selection);
		if (!text) {
			saveAffordance = null;
			return;
		}

		const anchorElement =
			selection.anchorNode instanceof Element
				? selection.anchorNode
				: selection.anchorNode?.parentElement;
		const focusElement =
			selection.focusNode instanceof Element
				? selection.focusNode
				: selection.focusNode?.parentElement;
		// Same container required, not just any two: a drag from one message
		// across the gap into another would otherwise save the whole span.
		const anchorSource = anchorElement?.closest('[data-term-source]');
		const focusSource = focusElement?.closest('[data-term-source]');
		if (!anchorSource || anchorSource !== focusSource) {
			saveAffordance = null;
			return;
		}

		const rect = selection.getRangeAt(0).getBoundingClientRect();
		saveAffordance = { text, x: rect.left + rect.width / 2, y: rect.top };
	}

	function saveSelectedTerm() {
		if (!saveAffordance) return;
		termsState.save(saveAffordance.text);
		document.getSelection()?.removeAllRanges();
		saveAffordance = null;
	}

	/** Cap the harvested spans so a long answer cannot build a runaway tray. */
	const HARVEST_CAP = 20;

	/** The transient harvest for one settled message: the model's proposed spans,
	 * held in component memory only. Nothing here is persisted; a chosen span
	 * reaches the pool solely through `termsState.save` (ADR-0102). One open at a
	 * time, like the selection affordance above. */
	let harvest = $state<{
		messageId: string;
		status: 'loading' | 'ready' | 'error';
		candidates: string[];
	} | null>(null);

	/** Ask the model for the notable spans in one settled message and open the
	 * tray with them. It is a one-shot completion (`complete`), so it writes no
	 * transcript turn and stores no gloss or provenance: the response lives only in
	 * `harvest.candidates` until the user saves or dismisses it. */
	async function harvestMessage(messageId: string, passage: string) {
		harvest = { messageId, status: 'loading', candidates: [] };
		const model = active?.model;
		if (!model) {
			harvest = { messageId, status: 'error', candidates: [] };
			return;
		}
		const connection = inferenceConnections.resolveOrHosted(model);
		const { data, error } = await complete(connection, {
			model,
			systemPrompt: buildHarvestPrompt(),
			userPrompt: passage,
		});
		// A dismiss or a harvest of another message may have superseded this request
		// while it was in flight; drop the stale result rather than overwrite.
		if (harvest?.messageId !== messageId) return;
		if (error) {
			harvest = { messageId, status: 'error', candidates: [] };
			return;
		}
		harvest = {
			messageId,
			status: 'ready',
			candidates: parseHarvestCandidates(data).slice(0, HARVEST_CAP),
		};
	}

	/** Whether a candidate is already in the pool, derived from terms so it is
	 * never stored on the candidate and reflects a save immediately. */
	function isTermSaved(text: string): boolean {
		return termsState.terms.some((term) => term.text === text);
	}

	/** Land a dictated transcript in the draft for review, appended to whatever is
	 * already typed. Guarded so it is a no-op if the conversation went away. */
	function appendTranscript(text: string) {
		if (!active) return;
		const draft = active.inputValue.trim();
		active.inputValue = draft ? `${draft} ${text}` : text;
	}
</script>

<svelte:document onselectionchange={handleSelectionChange} />

{#if saveAffordance}
	<button
		type="button"
		class="fixed z-50 -translate-x-1/2 -translate-y-full rounded border bg-popover px-2 py-1 text-xs shadow-sm"
		style="left: {saveAffordance.x}px; top: {saveAffordance.y - 6}px;"
		onpointerdown={(event) => event.preventDefault()}
		onclick={saveSelectedTerm}
	>
		Save term
	</button>
{/if}

{#if active}
	<AgentChatThread
		conversation={active}
		connections={inferenceConnections}
		placeholder="Ask about a word, phrase, or sentence you're learning..."
		onSignIn={() => void auth.startSignIn()}
	>
		{#snippet inputAccessory()}
			<DictationButton disabled={isGenerating} onTranscript={appendTranscript} />
		{/snippet}
		{#snippet message(msg, streaming)}
			{#if msg.role === 'user' || streaming}
				<!-- Raw text while the answer streams (and for the user's own turn): the
				rich markdown + readings pass runs once the message settles. -->
				<div class="whitespace-pre-wrap">{agentMessageText(msg)}</div>
			{:else}
				<div data-term-source>
					<ReadingMarkdown passage={agentMessageText(msg)} {showReadings} />
				</div>

				{#if harvest?.messageId === msg.id}
					<div class="mt-2 rounded-md border bg-muted/40 p-2">
						{#if harvest.status === 'loading'}
							<p class="text-xs text-muted-foreground">Harvesting terms...</p>
						{:else if harvest.status === 'error'}
							<div class="flex items-center justify-between gap-2">
								<p class="text-xs text-muted-foreground">
									Couldn't read terms from this message.
								</p>
								<div class="flex gap-1">
									<Button
										variant="ghost"
										size="sm"
										onclick={() => harvestMessage(msg.id, agentMessageText(msg))}
									>
										Try again
									</Button>
									<Button variant="ghost" size="sm" onclick={() => (harvest = null)}>
										Dismiss
									</Button>
								</div>
							</div>
						{:else if harvest.candidates.length === 0}
							<div class="flex items-center justify-between gap-2">
								<p class="text-xs text-muted-foreground">No terms found here.</p>
								<Button variant="ghost" size="sm" onclick={() => (harvest = null)}>
									Dismiss
								</Button>
							</div>
						{:else}
							<div class="mb-1.5 flex items-center justify-between">
								<span class="text-xs text-muted-foreground">
									Tap a term to save it
								</span>
								<Button variant="ghost" size="sm" onclick={() => (harvest = null)}>
									Dismiss
								</Button>
							</div>
							<div class="flex flex-wrap gap-1.5">
								{#each harvest.candidates as candidate (candidate)}
									{@const saved = isTermSaved(candidate)}
									<button
										type="button"
										class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm {saved
											? 'text-muted-foreground'
											: 'hover:bg-accent'}"
										disabled={saved}
										onclick={() => termsState.save(candidate)}
									>
										{#if saved}<CheckIcon class="size-3" />{/if}
										{candidate}
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{:else}
					<button
						type="button"
						class="mt-1.5 text-xs text-muted-foreground hover:text-foreground"
						onclick={() => harvestMessage(msg.id, agentMessageText(msg))}
					>
						Harvest terms
					</button>
				{/if}
			{/if}
		{/snippet}
		{#snippet emptyState()}
			<div
				class="flex flex-1 items-center justify-center text-muted-foreground"
			>
				<p>
					Ask a question and get an answer in the language you're learning, plus
					English.
				</p>
			</div>
		{/snippet}
	</AgentChatThread>
{/if}
