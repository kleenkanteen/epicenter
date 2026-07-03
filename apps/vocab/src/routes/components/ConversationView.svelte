<script lang="ts">
	import {
		AgentChatThread,
		type ConversationHandle,
	} from '@epicenter/app-shell/agent-chat';
	import { Markdown, type Romanizer } from '@epicenter/ui/markdown';
	import { agentMessageText } from '@epicenter/workspace/agent';
	import { pinyinRomanizer } from '$lib/romanize/pinyin';
	import { auth } from '$platform/auth';
	import { inferenceConnections } from '$lib/state/inference-connections.svelte';
	import { wordsState } from '$lib/state/words.svelte';
	import DictationButton from './DictationButton.svelte';

	let {
		active,
		showPinyin,
	}: { active: ConversationHandle | undefined; showPinyin: boolean } = $props();

	// `active` does not narrow inside a snippet closure (a snippet can outlive the
	// `{#if active}` guard), so the input accessory reads these instead of the
	// handle directly.
	const isGenerating = $derived(active?.isLoading ?? false);

	/** Hiding pinyin drops the readings but keeps the tap targets: no-pinyin is
	 * a recognition drill, and tapping an unrecognized word to save it is
	 * exactly the move it must keep. (Passing `showReadings={false}` instead
	 * would swap in the identity romanizer and strip the `term` stamps too.) */
	const termsOnlyRomanizer: Romanizer = (text) =>
		pinyinRomanizer(text).map((segment) => ({
			text: segment.text,
			term: segment.term,
		}));

	/** Land a dictated transcript in the draft for review, appended to whatever is
	 * already typed. Guarded so it is a no-op if the conversation went away. */
	function appendTranscript(text: string) {
		if (!active) return;
		const draft = active.inputValue.trim();
		active.inputValue = draft ? `${draft} ${text}` : text;
	}
</script>

{#if active}
	<AgentChatThread
		conversation={active}
		connections={inferenceConnections}
		placeholder="Ask something in English..."
		onSignIn={() => void auth.startSignIn()}
	>
		{#snippet inputAccessory()}
			<DictationButton disabled={isGenerating} onTranscript={appendTranscript} />
		{/snippet}
		{#snippet message(msg, streaming)}
			{#if msg.role === 'user' || streaming}
				<!-- Raw text while the answer streams (and for the user's own turn): the
				rich markdown + pinyin pass runs once the message settles. -->
				<div class="whitespace-pre-wrap">{agentMessageText(msg)}</div>
			{:else}
				<Markdown
					content={agentMessageText(msg)}
					romanizer={showPinyin ? pinyinRomanizer : termsOnlyRomanizer}
					onTermTap={(term) => wordsState.capture(term)}
					termActionLabel="Save word"
				/>
			{/if}
		{/snippet}
		{#snippet emptyState()}
			<div
				class="flex flex-1 items-center justify-center text-muted-foreground"
			>
				<p>
					Ask a question in English and get a response in Chinese and English.
				</p>
			</div>
		{/snippet}
	</AgentChatThread>
{/if}
