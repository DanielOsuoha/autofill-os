# Hosted OAuth broker (Cloudflare Workers)

This deploys the original Autofill OS confidential-client OAuth flow. It is separate from `identity-test`, which cannot currently select both accounts reliably. No database, custom domain or local server is required after switching the original extension to the hosted endpoint.

## Deploy

Use Node 22.12+ and the installed project-local Wrangler. From the repository root:

1. `npm run oauth:cloud:login` — authorize in your browser (if not already logged in).
2. `npm run test:cloudflare`, `npm run test:cloudflare:runtime`, and `npm run oauth:cloud:check` — security tests, actual workerd runtime regression tests, and packaging dry run.
3. `npm run oauth:cloud:deploy` — creates `autofill-os-oauth` in the selected Cloudflare account. Before secrets are configured, it returns 503 and exchanges no tokens.
4. `npm run oauth:cloud:secrets` — reads only GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and EXTENSION_ID from the original ignored `server/.env`, checks that the client matches the original extension's `.env`, and uploads via stdin. Nothing secret is placed in command arguments or source. This updates the live deployment.
5. Copy the returned workers.dev URL and run `npm run oauth:cloud:use -- https://autofill-os-oauth.YOUR-SUBDOMAIN.workers.dev/token`. It checks the hosted health endpoint with the original extension's Origin before updating the ignored root `.env`.
6. `npm run build`. Reload the ORIGINAL Autofill OS extension at chrome://extensions and refresh websites where its content script was already loaded. Check its server connection in the popup and connect/check both Gmail accounts. Existing grants should still be usable because the original Google client is unchanged.

Do not use the diagnostic extension's ID or Chrome Extension OAuth client. The production flow uses the existing Web application client and exact redirect `https://EXTENSION_ID.chromiumapp.org/oauth2`. The original extension's ID must match `server/.env`. Moving an unpacked extension without a public manifest key can change its ID. Verify Chrome's displayed ID before changing OAuth configuration or reloading from a different folder.

Once the hosted build is working, stop the local broker terminal (Ctrl+C). If you previously installed the optional launchd agent, unload only that agent. Local configuration files can remain ignored on disk; they are not an internet listener. Do not expose port 8787 or create a tunnel.

## Protections and limitations

- Exact original extension Origin; browser CORS is not authentication against non-browser clients that can spoof Origin.
- Google validates code + PKCE or refresh token against a fixed server-side client. No caller-controlled upstream, credentials or redirect.
- Only JSON POST /token, bounded 16 KiB body, five-second body deadline and ten-second Google deadline. No tokens in URL parameters.
- Cloudflare rate-limit bindings: 30 token attempts/minute/IP and 120/minute per edge location. Counters are approximate, not a strict global quota; shared IPs can share limits. This reduces abuse but does not guarantee availability under a distributed attack or exhausted free quota.
- No application token, request-body or response-body logs. Invocation logs are disabled; sampled platform traces/diagnostics are enabled. Do not add sensitive headers/body fields to tracing or logging.
- Google client secret is stored as a Cloudflare encrypted secret binding. Tokens are processed in request memory and returned with no-store; no token database is created. Hosting means trusting Cloudflare's runtime and your Cloudflare account with this processing.
- Secret changes use `npm run oauth:cloud:secrets`. Code redeploys preserve secrets. Never commit `.env`, `.dev.vars`, credentials or Wrangler auth files.

The Node security tests mock Google and rate-limit bindings. The workerd runtime tests use real runtime bindings with a fake Google upstream and verify authorization-code exchanges, refreshes, error forwarding and redirect rejection. Dry run validates packaging. Live health/rejection probes validate deployment, but real Chrome consent and two-account refresh remain manual acceptance tests.

References: https://developers.cloudflare.com/workers/configuration/secrets/ and https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/.
