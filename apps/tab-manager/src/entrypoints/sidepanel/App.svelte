<script lang="ts">
	import { SignInMigrationDialog } from '@epicenter/app-shell/sign-in-migration';
	import { WorkspaceGate } from '@epicenter/app-shell/workspace-gate';
	import * as Empty from '@epicenter/ui/empty';
	import { Loading } from '@epicenter/ui/loading';
	import { Toaster } from '@epicenter/ui/sonner';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { ModeWatcher } from 'mode-watcher';
	import { onMount } from 'svelte';
	import { tabManagerBoot } from '$lib/session.svelte';
	import TabManagerApp from './TabManagerApp.svelte';

	// The outer await is async `chrome.storage`, not auth (ADR-0088's
	// tab-manager judgment point): once it resolves, the workspace bundle is
	// never null, so the app renders unconditionally.
	onMount(() => {
		void tabManagerBoot.whenReady.then(() => {
			// Signed-in only: prompt to migrate this device's local tabs and
			// bookmarks into the account (no-op when signed out or when there is
			// no local data). Fire and forget: `check()` owns its own
			// once-per-boot guard.
			void tabManagerBoot.signInMigration.check();
		});
	});
</script>

{#await tabManagerBoot.whenReady}
	<Loading class="h-full" label="Loading tabs…" />
{:then}
	<WorkspaceGate
		pending={tabManagerBoot.tabManager.whenReady}
		onForgetDevice={() => tabManagerBoot.tabManager.wipe()}
		onSignOut={() => tabManagerBoot.auth.signOut()}
	>
		<TabManagerApp />
	</WorkspaceGate>
	<SignInMigrationDialog migration={tabManagerBoot.signInMigration} />
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
