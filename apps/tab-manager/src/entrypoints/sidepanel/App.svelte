<script lang="ts">
	import { WorkspaceGate } from '@epicenter/app-shell/workspace-gate';
	import * as Empty from '@epicenter/ui/empty';
	import { Loading } from '@epicenter/ui/loading';
	import { Toaster } from '@epicenter/ui/sonner';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { ModeWatcher } from 'mode-watcher';
	import { tabManagerBoot } from '$lib/session.svelte';
	import TabManagerApp from './TabManagerApp.svelte';
</script>

{#await tabManagerBoot.whenReady}
	<Loading class="h-full" label="Loading tabs…" />
{:then}
	<!-- The outer await above is async `chrome.storage`, not auth (ADR-0088's
	     tab-manager judgment point): once it resolves, the workspace bundle is
	     never null, so the app renders unconditionally. -->
	<WorkspaceGate
		pending={tabManagerBoot.tabManager.whenReady}
		onForgetDevice={() => tabManagerBoot.tabManager.wipe()}
		onSignOut={() => tabManagerBoot.auth.signOut()}
	>
		<TabManagerApp />
	</WorkspaceGate>
{:catch}
	<Empty.Root class="h-full border-0">
		<Empty.Media>
			<TriangleAlertIcon class="size-8 text-muted-foreground" />
		</Empty.Media>
		<Empty.Title>Failed to load account</Empty.Title>
		<Empty.Description> Try reopening the side panel. </Empty.Description>
	</Empty.Root>
{/await}

<ModeWatcher />
<Toaster position="bottom-center" richColors closeButton />
