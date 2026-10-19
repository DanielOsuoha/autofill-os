import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { manifest } from './manifest.config';
export default defineConfig(({ mode }) => ({
  plugins: [react(), crx({ manifest: manifest(loadEnv(mode, process.cwd(), 'VITE_')) })],
  build: { sourcemap: false },
}));
