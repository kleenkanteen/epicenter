<!--
@component
One route-backed surface pill. The URL owns the selected surface (see routes.ts);
this button renders one navigation choice and navigates with the shared switch
options, so active state is always derived from the route, never held locally.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { goto } from '$app/navigation';
	import { SWITCH_NAV } from '$lib/routes';

	let {
		active,
		to,
		children,
	}: { active: boolean; to: string; children: Snippet } = $props();
</script>

<button
	type="button"
	aria-current={active ? 'true' : undefined}
	onclick={() => goto(to, SWITCH_NAV)}
	class={[
		'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition',
		active
			? 'bg-muted font-medium text-foreground'
			: 'text-muted-foreground hover:bg-muted/50',
	]}
>
	{@render children()}
</button>
