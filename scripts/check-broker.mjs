import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const extensionId = 'a'.repeat(32);
const child = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, GOOGLE_CLIENT_ID: 'fixture', GOOGLE_CLIENT_SECRET: 'fixture', EXTENSION_ID: extensionId, PORT: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
try {
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Broker startup timeout')), 5000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.stdout.on('data', data => { const match = String(data).match(/localhost:(\d+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
  });
  const endpoint = `http://127.0.0.1:${port}`;
  const headers = { Origin: `chrome-extension://${extensionId}` };
  assert.equal((await fetch(`${endpoint}/health`)).status, 403);
  const response = await fetch(`${endpoint}/health`, { headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal((await fetch(`${endpoint}/token`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
  assert.equal((await fetch(`${endpoint}/token`, { method: 'OPTIONS', headers })).status, 204);
  console.log('PASS: broker health, origin restriction, cache policy, preflight and invalid-request rejection.');
} finally {
  child.kill('SIGTERM');
  if (child.exitCode === null) await once(child, 'exit');
}
