<script lang="ts">
	import type {
		AgentMessage,
		ConversationSnapshot,
	} from '@epicenter/workspace/agent';

	const { snapshot }: { snapshot: ConversationSnapshot } = $props();

	const isEmpty = $derived(
		snapshot.messages.length === 0 &&
			snapshot.streaming === null &&
			!snapshot.isThinking,
	);

	let container: HTMLElement | undefined = $state();

	// Whether the user was near the bottom before this render; measured on
	// every scroll (including our own programmatic one), read by the effect.
	// Deliberately not $state: its changes should never rerun the effect.
	let nearBottom = true;

	function trackScroll() {
		if (!container) return;
		nearBottom =
			container.scrollHeight - container.scrollTop - container.clientHeight <
			80;
	}

	$effect(() => {
		// Every server event replaces the snapshot wholesale, so reading it is
		// the "new content arrived" signal.
		snapshot;
		if (container && nearBottom) container.scrollTop = container.scrollHeight;
	});
</script>

{#snippet bubble(message: AgentMessage)}
	<article class="bubble {message.role}">
		{#each message.parts as part, index (index)}
			{#if part.type === 'text'}
				<div class="text">{part.text}</div>
			{:else if part.type === 'tool-call'}
				<div class="tool-call">&rarr; {part.toolName}</div>
			{:else}
				<details class="tool-result" class:is-error={part.isError}>
					<summary>
						&larr; {part.toolName}{part.isError ? ' (error)' : ''}
					</summary>
					<pre>{part.content}</pre>
					{#if part.details !== undefined}
						<pre>{JSON.stringify(part.details, null, 2)}</pre>
					{/if}
				</details>
			{/if}
		{/each}
	</article>
{/snippet}

<div class="transcript" bind:this={container} onscroll={trackScroll}>
	{#if isEmpty}
		<p class="empty">No messages yet. Ask something to get started.</p>
	{/if}
	{#each snapshot.messages as message (message.id)}
		{@render bubble(message)}
	{/each}
	{#if snapshot.streaming}
		{@render bubble(snapshot.streaming)}
	{/if}
	{#if snapshot.isThinking}
		<div class="thinking" aria-label="The assistant is thinking">
			<span></span><span></span><span></span>
		</div>
	{/if}
</div>

<style>
	.transcript {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.empty {
		margin: auto;
		color: #6f737c;
	}

	.bubble {
		max-width: 72ch;
		padding: 7px 10px;
		border-radius: 8px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.bubble.user {
		align-self: flex-end;
		background: #23303f;
		color: #dfe5ec;
	}

	.bubble.assistant {
		align-self: flex-start;
		background: #1b1d22;
		border: 1px solid #26282e;
	}

	.text {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.tool-call,
	.tool-result summary {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 12px;
		color: #8fb4e8;
	}

	.tool-result summary {
		cursor: pointer;
		user-select: none;
	}

	.tool-result.is-error summary {
		color: #f59396;
	}

	.tool-result pre {
		margin: 4px 0 0;
		padding: 6px 8px;
		max-height: 240px;
		overflow: auto;
		font-size: 11.5px;
		background: #131418;
		border-radius: 5px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.thinking {
		align-self: flex-start;
		display: flex;
		gap: 4px;
		padding: 10px 12px;
	}

	.thinking span {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #6f737c;
		animation: pulse 1.2s ease-in-out infinite;
	}

	.thinking span:nth-child(2) {
		animation-delay: 0.2s;
	}

	.thinking span:nth-child(3) {
		animation-delay: 0.4s;
	}

	@keyframes pulse {
		0%,
		60%,
		100% {
			opacity: 0.35;
		}
		30% {
			opacity: 1;
		}
	}
</style>
