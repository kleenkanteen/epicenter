<script lang="ts">
	import { WorkspaceGate } from '@epicenter/app-shell/workspace-gate';
	import { reloadOnOwnerChange } from '@epicenter/svelte/auth';
	import { ConfirmationDialog } from '@epicenter/ui/confirmation-dialog';
	import { Toaster } from '@epicenter/ui/sonner';
	import * as Tooltip from '@epicenter/ui/tooltip';
	import { ModeWatcher } from 'mode-watcher';
	import { onMount } from 'svelte';
	import { auth } from '$platform/auth';
	import { opensidian } from '$lib/opensidian';
	import '../app.css';

	let { children } = $props();

	// Option A (ADR-0088): the doc is picked once at boot (the preset branch
	// inside `openOpensidianBrowser`); an owner-identity change reloads so the
	// next boot rebuilds the right doc.
	onMount(() => reloadOnOwnerChange(auth));
</script>

<WorkspaceGate
	pending={opensidian.whenReady}
	onForgetDevice={() => opensidian.wipe()}
	onSignOut={() => auth.signOut()}
>
	<Tooltip.Provider>
		{@render children()}
	</Tooltip.Provider>
</WorkspaceGate>

<ConfirmationDialog />
<Toaster />
<ModeWatcher defaultMode="dark" track={false} />
