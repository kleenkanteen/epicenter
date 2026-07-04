<script lang="ts">
	import { SignInMigrationDialog } from '@epicenter/app-shell/sign-in-migration';
	import { WorkspaceGate } from '@epicenter/app-shell/workspace-gate';
	import { reloadOnPrincipalChange } from '@epicenter/svelte/auth';
	import { ConfirmationDialog } from '@epicenter/ui/confirmation-dialog';
	import { Toaster } from '@epicenter/ui/sonner';
	import * as Tooltip from '@epicenter/ui/tooltip';
	import { ModeWatcher } from 'mode-watcher';
	import { onMount } from 'svelte';
	import { auth } from '$platform/auth';
	import { signInMigration } from '$lib/migration/sign-in-migration';
	import { vocab } from '$lib/vocab';
	import '../app.css';

	let { children } = $props();

	// Option A (ADR-0088): the doc is picked once at boot (the preset branch
	// inside `openVocabBrowser`); a principal identity change reloads so the next
	// boot rebuilds the right doc.
	onMount(() => reloadOnPrincipalChange(auth));

	// Signed-in only: prompt to migrate this device's local conversations into
	// the account (no-op when signed out or when there is no local data). Fire
	// and forget: `signInMigration.check()` owns its own once-per-boot guard.
	onMount(() => {
		void signInMigration.check();
	});
</script>

<svelte:head><title>Vocab</title></svelte:head>

<WorkspaceGate
	pending={vocab.whenReady}
	onForgetDevice={() => vocab.wipe()}
	onSignOut={() => auth.signOut()}
>
	<Tooltip.Provider>{@render children?.()}</Tooltip.Provider>
</WorkspaceGate>

<Toaster />
<ConfirmationDialog />
<SignInMigrationDialog migration={signInMigration} />
<ModeWatcher />
