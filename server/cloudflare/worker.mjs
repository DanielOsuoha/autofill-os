const MAX_BODY_BYTES = 16_384;
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ERRORS = new Set(['invalid_grant', 'invalid_client', 'invalid_request', 'unauthorized_client', 'unsupported_grant_type', 'invalid_scope', 'temporarily_unavailable']);

async function readBody(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw 413;
  if (!request.body) throw 400;
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  let timer;
  try {
    await Promise.race([
      (async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BODY_BYTES) throw 413;
          chunks.push(value);
        }
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(408), 5000); }),
    ]);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw typeof error === 'number' ? error : 400;
  } finally { clearTimeout(timer); }
}
const text = (value) => typeof value === 'string' && value.length > 0 && value.length <= 8192;

export function createBroker(upstreamFetch = fetch) {
  return async (request, env) => {
    const headers = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json', Vary: 'Origin', 'X-Content-Type-Options': 'nosniff' });
    const reply = (status, body) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
    if (!/^[a-p]{32}$/.test(env.EXTENSION_ID || '') || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.IP_LIMITER || !env.TOTAL_LIMITER) {
      return reply(503, { error: 'broker_not_configured' });
    }
    const origin = `chrome-extension://${env.EXTENSION_ID}`;
    // Browser origin checks are NOT authentication for arbitrary HTTP clients.
    // Google validates every code + PKCE proof or refresh token for our fixed client.
    if (request.headers.get('Origin') !== origin) return reply(403, { error: 'forbidden_origin' });
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    const url = new URL(request.url);
    if (url.protocol !== 'https:') return reply(400, { error: 'https_required' });
    if (url.search) return reply(400, { error: 'invalid_request' });
    if (!['/health', '/token'].includes(url.pathname)) return reply(404, { error: 'not_found' });
    if (request.method === 'OPTIONS') {
      const method = request.headers.get('Access-Control-Request-Method');
      if (method && method !== (url.pathname === '/health' ? 'GET' : 'POST')) return reply(405, { error: 'method_not_allowed' });
      return reply(204);
    }
    if (url.pathname === '/health') return request.method === 'GET'
      ? reply(200, { ok: true, service: 'autofill-os-oauth' }) : reply(405, { error: 'method_not_allowed' });
    if (request.method !== 'POST') return reply(405, { error: 'method_not_allowed' });
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply(415, { error: 'json_required' });
    try {
      // Coarse anonymous abuse controls; IP limits can affect users sharing a network.
      // Cloudflare counters are approximate and local to each edge location.
      const ip = request.headers.get('CF-Connecting-IP');
      if (!ip) return reply(403, { error: 'missing_client_address' });
      const perIp = await env.IP_LIMITER.limit({ key: ip });
      const total = perIp.success && await env.TOTAL_LIMITER.limit({ key: 'token-exchanges' });
      if (!perIp.success || !total.success) {
        headers.set('Retry-After', '60');
        return reply(429, { error: 'rate_limited' });
      }
      let body;
      try { body = await readBody(request); }
      catch (status) { return reply(status, { error: status === 413 ? 'request_too_large' : status === 408 ? 'request_timeout' : 'invalid_request' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: 'invalid_request' });
      const params = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET });
      if (body.grant_type === 'authorization_code') {
        const redirect = `https://${env.EXTENSION_ID}.chromiumapp.org/oauth2`;
        if (body.redirect_uri !== redirect || !text(body.code) || typeof body.code_verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(body.code_verifier)) return reply(400, { error: 'invalid_request' });
        params.set('grant_type', 'authorization_code'); params.set('code', body.code);
        params.set('redirect_uri', redirect); params.set('code_verifier', body.code_verifier);
      } else if (body.grant_type === 'refresh_token' && text(body.refresh_token)) {
        params.set('grant_type', 'refresh_token'); params.set('refresh_token', body.refresh_token);
      } else return reply(400, { error: 'invalid_request' });
      const upstream = await upstreamFetch(GOOGLE_TOKEN_URL, {
        method: 'POST', body: params, redirect: 'error', signal: AbortSignal.timeout(10_000),
      });
      const result = await upstream.json();
      if (!upstream.ok) return reply(upstream.status >= 500 ? 502 : 400, { error: GOOGLE_ERRORS.has(result?.error) ? result.error : 'token_exchange_failed' });
      if (!text(result?.access_token) || !Number.isFinite(result.expires_in) || result.expires_in <= 0) return reply(502, { error: 'invalid_token_response' });
      return reply(200, {
        access_token: result.access_token, expires_in: result.expires_in,
        ...(text(result.refresh_token) ? { refresh_token: result.refresh_token } : {}),
        ...(typeof result.scope === 'string' ? { scope: result.scope } : {}),
      });
    } catch { return reply(502, { error: 'token_exchange_failed' }); }
  };
}
export default { fetch: createBroker() };
