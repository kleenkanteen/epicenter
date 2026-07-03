<script lang="ts">
	const {
		isGenerating,
		isConnected,
		canRetry,
		onSend,
		onStop,
		onRetry,
	}: {
		isGenerating: boolean;
		isConnected: boolean;
		canRetry: boolean;
		/** Returns whether the message went out; the draft is kept on failure. */
		onSend: (content: string) => boolean;
		onStop: () => void;
		onRetry: () => void;
	} = $props();

	let draft = $state('');
	const canSend = $derived(
		isConnected && !isGenerating && draft.trim().length > 0,
	);

	function submit() {
		if (!canSend) return;
		if (!onSend(draft)) return;
		draft = '';
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' || event.shiftKey) return;
		event.preventDefault();
		submit();
	}
</script>

<div class="composer">
	<textarea
		bind:value={draft}
		onkeydown={handleKeydown}
		placeholder="Message Super Chat (Enter to send, Shift+Enter for a new line)"
		rows="3"
	></textarea>
	<div class="actions">
		{#if isGenerating}
			<button type="button" class="stop" onclick={onStop}>Stop</button>
		{/if}
		{#if canRetry}
			<button type="button" onclick={onRetry}>Retry</button>
		{/if}
		<button type="button" class="send" disabled={!canSend} onclick={submit}>
			Send
		</button>
	</div>
</div>

<style>
	.composer {
		flex: none;
		display: flex;
		gap: 8px;
		padding: 0 12px 12px;
		align-items: flex-end;
	}

	textarea {
		flex: 1;
		resize: none;
		padding: 7px 9px;
		font: inherit;
		color: inherit;
		background: #1b1d22;
		border: 1px solid #2c2f36;
		border-radius: 6px;
	}

	textarea:focus {
		outline: none;
		border-color: #3d6fb4;
	}

	.actions {
		display: flex;
		gap: 6px;
	}

	button {
		padding: 6px 12px;
		font: inherit;
		color: #d4d6db;
		background: #24262c;
		border: 1px solid #2c2f36;
		border-radius: 6px;
		cursor: pointer;
	}

	button:hover:not(:disabled) {
		background: #2b2e35;
	}

	button:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.send {
		background: #2f5e9e;
		border-color: #3d6fb4;
		color: #eef3fa;
	}

	.send:hover:not(:disabled) {
		background: #366cb5;
	}

	.stop {
		border-color: #5c2e31;
		color: #f2b8ba;
	}
</style>
