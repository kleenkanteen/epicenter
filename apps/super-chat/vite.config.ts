/**
 * Build the SPA as one self-contained document. The token gate 401s any
 * request without the bearer, and injected `<script src>` / `<link href>`
 * tags cannot carry one, so every byte of JS and CSS must inline into
 * dist/index.html.
 */

import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
	// Absolute, so the build works regardless of the invoking cwd (a relative
	// root resolves against process.cwd(), not this file).
	root: fileURLToPath(new URL('./src/ui', import.meta.url)),
	plugins: [
		// The plugin resolves svelte.config.js against the Vite root (src/ui),
		// so point it back at the package-root config explicitly.
		svelte({
			configFile: fileURLToPath(new URL('./svelte.config.js', import.meta.url)),
		}),
		viteSingleFile(),
	],
	build: {
		outDir: fileURLToPath(new URL('./dist', import.meta.url)),
		emptyOutDir: true,
	},
});
