import assert from 'node:assert/strict';
import { createBroker } from '../server/cloudflare/worker.mjs';
const id = 'a'.repeat(32);
const origin = `chrome-extension://${id}`;
const env = { EXTENSION_ID: id, GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', IP_LIMITER: { limit: async () => ({ success: true }) }, TOTAL_LIMITER: { limit: async () => ({ success: true }) } };
let calls = [];
const broker = createBroker(async (url, options) => {
  calls.push({ url, params: Object.fromEntries(options.body), redirect: options.redirect });
  return Response.json({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600, scope: 'gmail', id_token: 'never-return-this' });
});
const refresh = { grant_type: 'refresh_token', refresh_token: 'test-refresh' };
function request(body = refresh, options = {}) {
  return new Request('https://broker.workers.dev/token', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', ...options.headers }, body: typeof body === 'string' ? body : JSON.stringify(body), ...options });
}
const health = await broker(new Request('https://broker.workers.dev/health', { headers: { Origin: origin } }), env);
assert.equal(health.status, 200); assert.equal(health.headers.get('cache-control'), 'no-store');
assert.equal((await broker(new Request('https://broker.workers.dev/health'), env)).status, 403);
assert.equal((await broker(request(), {})).status, 503);
const preflight = await broker(new Request('https://broker.workers.dev/token', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } }), env);
assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
for (const body of ['{', null, [], {}, {grant_type:'password'}, {...refresh,refresh_token:''}, {grant_type:'authorization_code',code:'code',code_verifier:'x'.repeat(43),redirect_uri:'https://attacker.invalid'}]) {
  assert.equal((await broker(request(body), env)).status, 400);
}
assert.equal(calls.length, 0);
assert.equal((await broker(request('x'.repeat(16385)), env)).status, 413);
const denied = await broker(request(), {...env, IP_LIMITER:{limit:async()=>({success:false})}});
assert.equal(denied.status,429); assert.equal(denied.headers.get('retry-after'),'60');
assert.equal((await broker(request(), {...env,TOTAL_LIMITER:{limit:async()=>({success:false})}})).status,429);
assert.equal(calls.length,0);
const tokens = await (await broker(request({...refresh,client_id:'attacker',client_secret:'attacker',upstream:'https://attacker.invalid'}),env)).json();
assert.deepEqual(tokens,{access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,scope:'gmail'});
assert.equal(calls.at(-1).url,'https://oauth2.googleapis.com/token');
assert.equal(calls.at(-1).params.client_id,'test-client');
assert.equal(calls.at(-1).params.client_secret,'test-secret');
assert.equal(calls.at(-1).redirect,'manual');
assert.equal((await broker(request({grant_type:'authorization_code',code:'code',code_verifier:'x'.repeat(43),redirect_uri:`https://${id}.chromiumapp.org/oauth2`}),env)).status,200);
for (const [upstream, status, expected] of [
  [{error:'invalid_grant',error_description:'private'},400,'invalid_grant'],
  [{error:'private-secret',error_description:'private'},403,'token_exchange_failed'],
  [{access_token:'test',expires_in:-1},200,'invalid_token_response'],
]) {
  const handler=createBroker(async()=>Response.json(upstream,{status}));
  assert.deepEqual(await (await handler(request(),env)).json(),{error:expected});
}
const failing=createBroker(async()=>{throw Error('sensitive details')});
assert.deepEqual(await (await failing(request(),env)).json(),{error:'token_exchange_failed'});
console.log('PASS: hosted broker rejects invalid origins, grants, redirects, oversized bodies and rate-limited requests; fixes client credentials/upstream; filters tokens and errors. No real Google requests.');
