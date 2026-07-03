<script lang="ts">
	import { Button } from '@epicenter/ui/button';
	import { Input } from '@epicenter/ui/input';
	import * as Sidebar from '@epicenter/ui/sidebar';
	import type { Word, WordId } from '@epicenter/vocab';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import { wordsState } from '$lib/state/words.svelte';

	/** The one-way cycle a status button steps through on each click. */
	const NEXT_STATUS: Record<Word['status'], Word['status']> = {
		new: 'learning',
		learning: 'known',
		known: 'new',
	};

	let newTerm = $state('');
	let newGloss = $state('');

	function addWord() {
		if (wordsState.add({ term: newTerm, gloss: newGloss })) {
			newTerm = '';
			newGloss = '';
		}
	}

	function cycleStatus(id: WordId, status: Word['status']) {
		wordsState.setStatus(id, NEXT_STATUS[status]);
	}

	function commitGloss(word: Word, gloss: string) {
		if (gloss !== word.gloss) wordsState.setGloss(word.id, gloss);
	}
</script>

<Sidebar.Group class="group-data-[collapsible=icon]:hidden">
	<Sidebar.GroupLabel>
		<span>Words</span>
		<span class="ml-auto text-xs text-muted-foreground">
			known: {wordsState.knownCount}
		</span>
	</Sidebar.GroupLabel>
	<Sidebar.GroupContent>
		<form
			class="flex items-center gap-1 px-2 py-1"
			onsubmit={(event) => {
				event.preventDefault();
				addWord();
			}}
		>
			<Input bind:value={newTerm} placeholder="Term" class="h-7 text-sm" />
			<Input bind:value={newGloss} placeholder="Gloss" class="h-7 text-sm" />
			<Button type="submit" size="icon-sm" variant="outline" aria-label="Add word">
				<PlusIcon class="size-3.5" />
			</Button>
		</form>

		{#if wordsState.words.length === 0}
			<p class="px-2 py-1 text-xs text-muted-foreground">
				Tap a word in the chat to save it.
			</p>
		{:else}
			<Sidebar.Menu>
				{#each wordsState.words as word (word.id)}
					<Sidebar.MenuItem>
						<div class="flex w-full items-center gap-1.5 px-2 py-1">
							<span class="shrink-0 font-medium">{word.term}</span>
							<input
								class="min-w-0 flex-1 bg-transparent text-xs text-muted-foreground outline-none"
								value={word.gloss}
								placeholder="Gloss"
								onblur={(event) => commitGloss(word, event.currentTarget.value)}
							/>
							<button
								type="button"
								class="shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase hover:bg-accent"
								title="Cycle status: new, learning, known"
								onclick={() => cycleStatus(word.id, word.status)}
							>
								{word.status}
							</button>
						</div>
						<Sidebar.MenuAction
							showOnHover
							aria-label="Delete word"
							onclick={() => wordsState.remove(word.id)}
						>
							<TrashIcon class="size-3.5" />
						</Sidebar.MenuAction>
					</Sidebar.MenuItem>
				{/each}
			</Sidebar.Menu>
		{/if}
	</Sidebar.GroupContent>
</Sidebar.Group>
