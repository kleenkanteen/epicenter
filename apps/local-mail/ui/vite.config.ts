import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// The SPA is same-origin with the API. In production `local-mail app` serves
// both the built SPA and `/api` from one loopback origin. In dev, Vite serves
// the SPA and proxies `/api` to the running app process; the proxy injects the
// dev bearer (`LOCAL_MAIL_TOKEN`) server-side and rewrites Host via
// `changeOrigin`, so the app server's Host check and bearer check both pass
// without any credential ever reaching the browser (loopback shell spec, Dev mode).
const SPA_DEV_PORT = 5177;

export default defineConfig(({ command }) => {
	const APP_PORT = Number(process.env.LOCAL_MAIL_PORT) || 4177;
	// The proxy must send the exact bearer `app` accepts. No default: a silent
	// fallback that disagrees with `app` is the "Unauthorized" footgun. Both
	// processes read the same LOCAL_MAIL_TOKEN, so require it for the dev server.
	const DEV_TOKEN = process.env.LOCAL_MAIL_TOKEN;
	if (command === 'serve' && !DEV_TOKEN) {
		throw new Error(
			'LOCAL_MAIL_TOKEN is required for the dev server so its /api proxy sends the same bearer as `local-mail app`. Start both with the same token, e.g. LOCAL_MAIL_TOKEN=devtoken.',
		);
	}
	return {
		plugins: [sveltekit(), tailwindcss()],
		server: {
			port: SPA_DEV_PORT,
			strictPort: true,
			proxy: {
				'/api': {
					target: `http://127.0.0.1:${APP_PORT}`,
					changeOrigin: true,
					configure: (proxy) => {
						proxy.on('proxyReq', (proxyReq) => {
							proxyReq.setHeader('authorization', `Bearer ${DEV_TOKEN}`);
						});
					},
				},
			},
		},
	};
});
