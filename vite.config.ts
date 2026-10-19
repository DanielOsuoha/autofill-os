import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { manifest } from './manifest.config';
export default defineConfig(({ mode, command }) => ({
  // CRXJS's standalone library build needs React's environment replaced too.
  define: { 'process.env.NODE_ENV': JSON.stringify(command === 'build' ? 'production' : 'development') },
  plugins: [
    react(),
    crx({
      manifest: manifest(loadEnv(mode, process.cwd(), 'VITE_')),
      liveReload: true,
      // Inject a self-contained script instead of importing extension modules
      // from the page's frame through CRXJS's dynamic-import loader.
      contentScripts: { standaloneFiles: ['src/content/index.tsx'] },
    }),
    {
      name: 'autofill:crx-worker-live-reload-fix',
      apply: 'serve',
      enforce: 'post',
      transform(code, id) {
        // CRXJS 2.7.1 replaces only the first occurrence in its worker client.
        // Keep the remaining reconnect guard consistent with liveReload above.
        if (id.split('?')[0] === '/@crx/client-worker' && code.includes('__LIVE_RELOAD__')) {
          return { code: code.replaceAll('__LIVE_RELOAD__', 'true'), map: null };
        }
      },
    },
  ],
  build: { sourcemap: false },
}));
