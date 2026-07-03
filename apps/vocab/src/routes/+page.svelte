<script lang="ts">
	import { createAgentChatState } from '@epicenter/app-shell/agent-chat';
	import { fromKv } from '@epicenter/svelte';
	import { Button } from '@epicenter/ui/button';
	import * as Sidebar from '@epicenter/ui/sidebar';
	import { VOCAB_MODEL, VOCAB_SYSTEM_PROMPT } from '@epicenter/vocab';
	import { onDestroy } from 'svelte';
	import { buildPracticePrompt } from '$lib/practice';
	import { inferenceConnections } from '$lib/state/inference-connections.svelte';
	import { vocab } from '$lib/vocab';
	import ConversationView from './components/ConversationView.svelte';
	import VocabSidebar from './components/VocabSidebar.svelte';

	const showPinyin = fromKv(vocab.kv, 'showPinyin');

	// The shared chat registry (ADR-0047/0059) with Vocab's variation injected:
	// capability-free (no tools, no approval), one Chinese-tuned system prompt, and
	// the hosted VOCAB_MODEL as the default a new conversation starts on. The active
	// conversation lives in internal state (Vocab has no URL seam).
	const chat = createAgentChatState({
		table: vocab.tables.conversations,
		whenLoaded: vocab.storage.whenLoaded,
		connections: inferenceConnections,
		agent: {
			buildSystemPrompts: () => [VOCAB_SYSTEM_PROMPT],
			defaultModel: VOCAB_MODEL,
		},
	});

	onDestroy(() => chat[Symbol.dispose]());

	/** Compile the chosen terms into a practice turn and send it. Focus lands in
	 * the active conversation, opening one only when none exists. The passage
	 * comes back under the tutor system prompt; nothing is written to the terms. */
	function practice(termTexts: string[]) {
		if (termTexts.length === 0) return;
		if (!chat.active) chat.createConversation();
		chat.active?.sendMessage(buildPracticePrompt(termTexts));
	}
</script>

<Sidebar.Provider>
	<VocabSidebar
		conversations={chat.conversations}
		activeConversationId={chat.activeConversationId}
		onCreate={() => chat.createConversation()}
		onSwitch={(conversationId) => chat.switchTo(conversationId)}
		onPractice={practice}
		generating={chat.active?.isLoading ?? false}
	/>

	<main class="flex h-dvh flex-1 flex-col">
		<header class="flex items-center justify-between border-b px-4 py-3">
			<div class="flex items-center gap-3">
				<Sidebar.Trigger />
				<h1 class="text-lg font-semibold">中文 Vocab</h1>
			</div>

			<div class="flex items-center gap-2">
				<Button
					variant={showPinyin.current ? 'default' : 'outline'}
					size="sm"
					onclick={() => (showPinyin.current = !showPinyin.current)}
					aria-pressed={showPinyin.current}
					aria-label="Toggle pinyin annotations"
				>
					{showPinyin.current ? 'Hide Pinyin' : 'Show Pinyin'}
				</Button>
			</div>
		</header>

		<ConversationView active={chat.active} showPinyin={showPinyin.current} />
	</main>
</Sidebar.Provider>
