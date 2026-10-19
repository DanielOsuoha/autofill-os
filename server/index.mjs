// Minimal confidential-client token broker. Deploy behind HTTPS; never bundle this file's env into Vite.
import { createServer } from 'node:http';
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, EXTENSION_ID, PORT = '8787' } = process.env;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !/^[a-p]{32}$/.test(EXTENSION_ID || '')) {
  throw new Error('Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and EXTENSION_ID in server/.env.');
}
const origin = `chrome-extension://${EXTENSION_ID}`;
const redirect = `https://${EXTENSION_ID}.chromiumapp.org/oauth2`;
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Vary', 'Origin');
  const respond = (status, body) => { res.writeHead(status); res.end(JSON.stringify(body)); };
  if (req.headers.origin !== origin) return respond(403, { error: 'forbidden_origin' });
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.url === '/health' && req.method === 'GET') return respond(200, { ok: true });
  if (req.url !== '/token') return respond(404, { error: 'not_found' });
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method !== 'POST' || !req.headers['content-type']?.startsWith('application/json')) return respond(400, { error: 'invalid_request' });
  try {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 16_384) { respond(413, { error: 'request_too_large' }); req.destroy(); return; }
    }
    const body = JSON.parse(raw);
    const params = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET });
    if (body.grant_type === 'authorization_code') {
      if (body.redirect_uri !== redirect || typeof body.code !== 'string' || !body.code ||
          typeof body.code_verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(body.code_verifier)) return respond(400, { error: 'invalid_request' });
      params.set('grant_type', 'authorization_code'); params.set('code', body.code);
      params.set('redirect_uri', redirect); params.set('code_verifier', body.code_verifier);
    } else if (body.grant_type === 'refresh_token' && typeof body.refresh_token === 'string' && body.refresh_token) {
      params.set('grant_type', 'refresh_token'); params.set('refresh_token', body.refresh_token);
    } else return respond(400, { error: 'invalid_request' });
    const upstream = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', body: params, signal: AbortSignal.timeout(10_000),
    });
    const result = await upstream.json();
    if (!upstream.ok) return respond(upstream.status, { error: result.error || 'token_exchange_failed' });
    // Return only the tokens the extension needs. Do not log token requests or responses.
    respond(200, { access_token: result.access_token, refresh_token: result.refresh_token, expires_in: result.expires_in, scope: result.scope });
  } catch { respond(502, { error: 'token_exchange_failed' }); }
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(Number(PORT), '127.0.0.1', () => console.log(`OAuth broker listening on localhost:${server.address().port}`));
const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
