<script lang="ts">
	import Composer from './Composer.svelte';
	import Transcript from './Transcript.svelte';
	import { createSession } from './session.svelte.ts';

	const { token }: { token: string | null } = $props();

	// The token never changes within a page load (boot strips it from the URL
	// and passes it once), so capturing its initial value is the point.
	// svelte-ignore state_referenced_locally
	const session = token === null ? null : createSession({ token });

	const connectionLabel = {
		connecting: 'Connecting',
		open: 'Connected',
		closed: 'Disconnected',
	} as const;

	function formatApprovalInput(input: unknown): string {
		return JSON.stringify(input, null, 2);
	}
</script>

{#if session === null}
	<main class="missing-token">
		<h1>Super Chat</h1>
		<p>
			This page is missing its launch token. Relaunch Super Chat from the app;
			opening this address by hand will not work.
		</p>
	</main>
{:else}
	<div class="shell">
		<header>
			<span class="title">Super Chat</span>
			<span class="connection {session.connection}">
				<span class="dot"></span>
				{connectionLabel[session.connection]}
			</span>
			<details class="tools">
				<summary>
					{session.tools.length}
					{session.tools.length === 1 ? 'tool' : 'tools'}
				</summary>
				<ul>
					{#each session.tools as tool (tool.name)}
						<li>
							<code>{tool.name}</code>
							{#if tool.title}<span class="tool-title">{tool.title}</span>{/if}
							{#if tool.description}
								<p class="tool-description">{tool.description}</p>
							{/if}
						</li>
					{/each}
				</ul>
			</details>
		</header>

		<Transcript snapshot={session.snapshot} />

		{#if session.snapshot.error}
			<div class="error" role="alert">
				<strong>
					Turn failed{session.snapshot.error.code
						? ` (${session.snapshot.error.code})`
						: ''}:
				</strong>
				{session.snapshot.error.message}
			</div>
		{/if}

		{#if session.pendingApprovals.length > 0}
			<section class="approvals" aria-label="Pending approvals">
				{#each session.pendingApprovals as approval (approval.id)}
					<div class="approval">
						<strong>{approval.title ?? approval.toolName}</strong>
						{#if approval.description}
							<p>{approval.description}</p>
						{/if}
						<pre>{formatApprovalInput(approval.input)}</pre>
						<div class="approval-actions">
							<button
								type="button"
								onclick={() => session.approve(approval.id, true)}
							>
								Approve
							</button>
							<button
								type="button"
								onclick={() => session.approve(approval.id, true, true)}
							>
								Always allow
							</button>
							<button
								type="button"
								class="secondary"
								onclick={() => session.approve(approval.id, false)}
							>
								Deny
							</button>
						</div>
					</div>
				{/each}
			</section>
		{/if}

		<Composer
			isGenerating={session.snapshot.isGenerating}
			isConnected={session.connection === 'open'}
			canRetry={session.snapshot.error !== null &&
				!session.snapshot.isGenerating}
			onSend={(content) => session.send(content)}
			onStop={() => session.stop()}
			onRetry={() => session.retry()}
		/>
	</div>
{/if}

<style>
	.shell {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	header {
		display: flex;
		align-items: baseline;
		gap: 12px;
		padding: 8px 12px;
		border-bottom: 1px solid #26282e;
		flex: none;
	}

	.title {
		font-weight: 600;
		color: #eceef2;
	}

	.connection {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		color: #8b8f98;
	}

	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #8b8f98;
	}

	.connection.open .dot {
		background: #4cc38a;
	}

	.connection.connecting .dot {
		background: #d8b44a;
	}

	.connection.closed .dot {
		background: #e5484d;
	}

	.tools {
		margin-left: auto;
		position: relative;
		font-size: 12px;
		color: #8b8f98;
	}

	.tools summary {
		cursor: pointer;
		user-select: none;
	}

	.tools ul {
		position: absolute;
		right: 0;
		top: calc(100% + 4px);
		z-index: 1;
		margin: 0;
		padding: 8px 10px;
		list-style: none;
		width: 320px;
		max-height: 60vh;
		overflow-y: auto;
		background: #1a1c21;
		border: 1px solid #2c2f36;
		border-radius: 6px;
	}

	.tools li + li {
		margin-top: 8px;
		padding-top: 8px;
		border-top: 1px solid #26282e;
	}

	.tools code {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 11.5px;
		color: #c3c6cc;
	}

	.tool-title {
		margin-left: 6px;
		color: #8b8f98;
	}

	.tool-description {
		margin: 2px 0 0;
		color: #7a7e87;
	}

	.error {
		flex: none;
		margin: 0 12px 8px;
		padding: 8px 10px;
		border: 1px solid #5c2e31;
		border-radius: 6px;
		background: #2a1d1e;
		color: #f2b8ba;
	}

	.error strong {
		color: #f59396;
	}

	.approvals {
		flex: none;
		display: grid;
		gap: 8px;
		margin: 0 12px 8px;
	}

	/* Always stacked: copy above actions, at every width. Approvals are rare
	   and sit above the composer, so vertical space is the honest dimension;
	   one layout serves the desktop window and a remote phone alike. */
	.approval {
		padding: 10px;
		border: 1px solid #5a4a27;
		border-radius: 6px;
		background: #272318;
		color: #e8dcc1;
	}

	.approval strong {
		display: block;
		color: #f0e6cc;
	}

	.approval p {
		margin: 3px 0 0;
		color: #b9ad92;
	}

	.approval pre {
		margin: 8px 0 0;
		max-height: 120px;
		overflow: auto;
		white-space: pre-wrap;
		word-break: break-word;
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 11.5px;
		color: #d7cfbd;
	}

	.approval-actions {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		margin-top: 10px;
	}

	.approval-actions button {
		height: 28px;
		border: 1px solid #7d6733;
		border-radius: 5px;
		background: #d8b44a;
		color: #1e1a10;
		font: inherit;
		font-size: 12px;
		cursor: pointer;
	}

	.approval-actions button.secondary {
		background: transparent;
		color: #d7cfbd;
	}

	.missing-token {
		max-width: 32rem;
		margin: 20vh auto 0;
		padding: 0 16px;
	}

	.missing-token h1 {
		font-size: 16px;
		color: #eceef2;
	}

	.missing-token p {
		color: #a3a7af;
	}
</style>
