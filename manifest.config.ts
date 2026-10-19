import { defineManifest } from '@crxjs/vite-plugin';

export function manifest(env: Record<string, string>) {
  const icons = { '16': 'icons/icon-16.png', '32': 'icons/icon-32.png', '48': 'icons/icon-48.png', '128': 'icons/icon-128.png' };
  const hosts = ['https://www.googleapis.com/*'];
  if (env.VITE_OAUTH_TOKEN_ENDPOINT) {
    const url = new URL(env.VITE_OAUTH_TOKEN_ENDPOINT);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) {
      throw new Error('The token endpoint must use HTTPS (or localhost for development).');
    }
    hosts.push(`${url.origin}/*`);
  }
  return defineManifest({
    manifest_version: 3,
    name: 'Autofill OS', version: '0.1.0',
    description: 'Find fresh Gmail verification codes across two accounts and paste them with one click.',
    minimum_chrome_version: '116',
    icons,
    permissions: ['identity', 'storage', 'activeTab', 'scripting'],
    host_permissions: hosts,
    ...(env.VITE_EXTENSION_KEY ? { key: env.VITE_EXTENSION_KEY } : {}),
    background: { service_worker: 'src/background/index.ts', type: 'module' },
    action: { default_popup: 'src/popup/index.html', default_title: 'Autofill OS', default_icon: icons },
    content_scripts: [{ matches: ['https://*/*', 'http://*/*'], js: ['src/content/index.tsx'], world: 'ISOLATED', run_at: 'document_idle' }],
  });
}
