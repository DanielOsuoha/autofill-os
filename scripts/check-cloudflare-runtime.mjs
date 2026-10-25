// Run the production entrypoint in workerd, not Node's fetch implementation.
// All credentials and upstream responses are synthetic; no Google traffic occurs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
const id = 'a'.repeat(32);
let mode = 'success';
let upstreamCalls = 0;
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  script: readFileSync(new URL('../server/cloudflare/worker.mjs', import.meta.url), 'utf8'),
  compatibilityDate: '2026-10-24',
  bindings: { EXTENSION_ID: id, GOOGLE_CLIENT_ID: 'fake-client', GOOGLE_CLIENT_SECRET: 'fake-secret' },
  ratelimits: {
    IP_LIMITER: { namespace_id: '878701', simple: { limit: 30, period: 60 } },
    TOTAL_LIMITER: { namespace_id: '878702', simple: { limit: 120, period: 60 } },
  },
  outboundService: async (request) => {
    upstreamCalls++;
    assert.equal(request.url, 'https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(await request.text());
    assert.equal(body.get('client_id'), 'fake-client');
    assert.equal(body.get('client_secret'), 'fake-secret');
    if (mode === 'redirect') return new Response(null, { status: 302, headers: { Location: 'https://attacker.invalid' } });
    if (mode === 'invalid') return Response.json({ error: 'invalid_grant', error_description: 'must not be exposed' }, { status: 400 });
    return Response.json({ access_token: 'fake-access', refresh_token: 'fake-refresh', expires_in: 3600, scope: 'gmail', id_token: 'must-not-be-exposed' });
  },
}));
const headers = { Origin: `chrome-extension://${id}`, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' };
const exchange = (body) => mf.dispatchFetch('https://broker.example/token', { method: 'POST', headers, body: JSON.stringify(body) });
try {
  for (const body of [
    { grant_type: 'authorization_code', code: 'fake-code', code_verifier: 'x'.repeat(43), redirect_uri: `https://${id}.chromiumapp.org/oauth2` },
    { grant_type: 'refresh_token', refresh_token: 'fake-refresh' },
  ]) {
    const response = await exchange(body);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { access_token: 'fake-access', refresh_token: 'fake-refresh', expires_in: 3600, scope: 'gmail' });
  }
  mode = 'invalid';
  const rejected = await exchange({ grant_type: 'refresh_token', refresh_token: 'fake-refresh' });
  assert.equal(rejected.status, 400);
  assert.deepEqual(await rejected.json(), { error: 'invalid_grant' });
  mode = 'redirect';
  const before = upstreamCalls;
  const redirected = await exchange({ grant_type: 'refresh_token', refresh_token: 'fake-refresh' });
  assert.equal(redirected.status, 502);
  assert.deepEqual(await redirected.json(), { error: 'token_exchange_failed' });
  assert.equal(upstreamCalls, before + 1, 'Google redirects must never be followed');
  console.log('PASS: workerd exchanges authorization codes and refresh tokens, preserves Google error codes, and rejects upstream redirects without leaking credentials.');
} finally { await mf.dispose(); }
