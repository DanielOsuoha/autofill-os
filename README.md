# Autofill OS — Phase 1

Manifest V3 Chrome extension built with Vite, CRXJS, React, TypeScript and Tailwind CSS. Connect up to two Gmail accounts, focus a verification field, and explicitly choose a fresh code to insert. The email is marked read after insertion; forms are never automatically submitted.

## Run locally

Requires Node.js 22.12+ and Chrome 116+.

```sh
npm install
cp .env.example .env
npm run build
```

Load `dist/` with **chrome://extensions → Developer mode → Load unpacked**. The initial build works without credentials, but Gmail connection requires the setup below. Run `npm run dev` for CRXJS development (it writes to `dist-dev/`, which must be loaded separately and has a different unpacked ID); reload the extension and target tabs after manifest changes. For testing an installable artifact, use `npm run build` and reload `dist/`.

## Google OAuth configuration

This implements authorization code + S256 PKCE through `chrome.identity.launchWebAuthFlow`, including a random state check, offline access, and explicit account selection. Google web OAuth clients require a client secret at the token endpoint. **A secret cannot be safely bundled in a Chrome extension.** The included small Node server performs token exchange/refresh using that secret. It does not store tokens. Do not put a client secret in a `VITE_` environment variable.

1. Create a Google Cloud project, enable the **Gmail API**, and configure the OAuth consent screen. Add your Gmail addresses as test users during development. Request `https://www.googleapis.com/auth/gmail.modify`.
2. Create an OAuth client of type **Web application**. Copy the client ID to `.env` (`VITE_GOOGLE_CLIENT_ID`) and `server/.env` (`GOOGLE_CLIENT_ID`). Copy `server/.env.example` to `server/.env` and put the client secret only there.
3. Load the initial extension build and copy its 32-character extension ID from Chrome. Set `EXTENSION_ID` in `server/.env`. Register **exactly** `https://EXTENSION_ID.chromiumapp.org/oauth2` as an authorized redirect URI in the Google web client. You can confirm it in the extension service worker console with `chrome.identity.getRedirectURL('oauth2')`.
4. Set `VITE_OAUTH_TOKEN_ENDPOINT=http://localhost:8787/token` for local use. Start the broker with `npm run oauth:server`. It binds to `127.0.0.1` and permits requests from the configured extension origin only.
5. Rebuild and reload the extension, then select **Connect Gmail account** in the popup. Consent to Gmail access. Repeat for a second account.
6. For deployment, serve the broker behind HTTPS, set the endpoint to its HTTPS URL, and rebuild (its origin is added to host permissions). Add deployment-level rate limiting and keep request/body logging disabled for `/token`. Origin checks constrain browser callers but are not authentication for arbitrary non-browser clients. Use the same configured client ID in both environments. The broker's upstream URL, client credentials, and redirect URI are fixed server-side.

The optional `VITE_EXTENSION_KEY` is a **public** manifest key used to keep extension IDs stable across machines/build paths. Otherwise the unpacked extension ID depends on its installation path; update the broker and Google's redirect URI if it changes. Never include a private signing key.

Google's restricted Gmail scope may require consent-screen verification/security assessment for production distribution. Testing-mode grants may expire and require reconnection. Reference: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [PKCE](https://developers.google.com/identity/protocols/oauth2/native-app), [Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity).

## Behavior and architecture

- `src/background/auth.ts`: PKCE, OAuth callback validation, Gmail profile lookup, serialized account writes, deduplicated refresh with a 60-second expiry buffer, and reconnect state for invalid refresh grants. Gmail calls refresh once on HTTP 401, retry transient network/5xx errors with bounded backoff, and respect rate-limit cooldowns. The two-account limit lives in `src/shared/config.ts`.
- `src/background/search.ts`: unread mail search using an exact `after:` Unix timestamp (Gmail's `newer_than:2m` means months, not minutes). Up to four pages of 25 messages per account, four concurrent body fetches per account, with per-search caching and warnings for incomplete results. Valid earlier matches survive later-page failures.
- `src/background/poller.ts`: waits of 2, 2, 3, 5, 8, 12 seconds, bounded by a 30-second wall-clock deadline including network requests. Offline sessions wait for `online` and recheck connectivity each second, without extending the deadline. One account's failure does not block the other's results. The default window is two minutes; after timeout/error, users can explicitly search the last five minutes.
- `src/background/parser.ts`: decodes nested MIME parts and HTML, validates message timestamps, finds 4–8 digits or 6–8 uppercase alphanumeric characters within 100 characters of verification keywords, and ranks sender-domain matches first. Alphanumeric candidates must contain a digit to avoid treating words such as SECURITY as codes. This is a heuristic; review the account and code before pasting.
- `src/content/detector.ts`: focus and mutation observation, OTP attributes/accessibility labels, adjacent groups of 4–8 single-character inputs, and focus inside open shadow roots. The popup's manual field picker handles unfamiliar input labels. Top-level HTTP(S) pages are supported; iframe fields, closed page shadow roots, Chrome internal pages and the Chrome Web Store are unsupported. Mutation observation does not traverse page shadow roots.
- `src/content/Widget.tsx`: isolated closed Shadow DOM with its own compiled Tailwind styles. Offers up to five matches with account, sender, subject, age and domain-match information; ranks sender-domain relevance and recency. A user gesture invokes native prototype setters and bubbling `input`/`change` events. Split code lengths must match exactly. Values are checked after a rendering turn before marking mail read. A mark-read failure leaves the pasted code intact and offers a retry. Sites may react to input events themselves, including navigation; Autofill OS never calls form submission.
- `src/popup`: account connection, disconnection, and reconnection. Disconnect deletes local credentials; it does not revoke Google's grant. Revoke that separately in your Google account's third-party app settings.
- `server/index.mjs`: dependency-free confidential OAuth token broker; accepts only authorization-code and refresh-token grants for the configured client.

Tokens are stored in `chrome.storage.local` as requested, with access restricted to `TRUSTED_CONTEXTS`. This is browser-profile storage, not an encrypted credential vault. Content scripts cannot fetch account tokens; account management is accepted only from the extension popup. Short-lived code receipts and search checkpoints live in trusted `chrome.storage.session`. Receipts expire after two minutes and are removed on use or pruned on subsequent matches. A five-second widget heartbeat recovers an interrupted worker search within its original deadline, or restores an offered result. Polling stops on tab changes/navigation; returning to the field starts a fresh search. Duplicate and superseded requests cannot overwrite the current search.

Manifest permissions: `identity`, `storage`, `activeTab`, `scripting`; API host access for `https://www.googleapis.com/*` and the configured token broker. Declarative content scripts run on HTTP(S) pages to detect fields automatically, so Chrome will display broad site-access permission. Tailwind styles are confined to the popup document and widget shadow root.

The search is capped at 100 unread messages per account per attempt. It does not download attachments, submit forms, or log messages/codes/tokens. Sender-domain ranking uses public-suffix boundaries (including private suffixes), but remains a relevance heuristic, not sender authentication. Codes can still be expired, ambiguous, or rejected by a website; the helper does not guarantee successful verification.

## Validation

```sh
npm run typecheck
npm test
npm run build
npm run test:extension
npx playwright install chromium
npm run test:browser
npm run test:broker
```

Automated coverage includes MIME/code parsing, public-suffix domain ranking, pagination/partial failures, field detection, insertion validation, PKCE, refresh failures, rate limits, deadlines, offline recovery and worker-checkpoint recovery. The Chromium suite loads the actual packaged extension in a disposable profile with mocked Gmail responses and real React-controlled single/split inputs; it also covers manual selection, navigation and removed fields. The broker test uses fake credentials and makes no Google requests. Live Google consent, real inbox access and third-party websites still require manual testing.

## Host the connection server online

Cloudflare Workers deployment and migration instructions are in [server/cloudflare/README.md](server/cloudflare/README.md). This keeps the original two-account OAuth flow and removes the need to run localhost after migration.

## Keep the local connection server available

The popup's **Check account connection server** button calls the broker's origin-restricted `/health` endpoint. A successful result means the broker is reachable; it does not prove that Google credentials or account grants are valid. Restart the broker after updating its code.

For macOS development, `server/macos.launchd.plist.example` provides an opt-in login service with automatic restarts. It is not installed by the build. Replace `ABSOLUTE_NODE_PATH` with the output of `command -v node` (Node 22.12+) and `ABSOLUTE_REPOSITORY_PATH` with this repository's absolute path. XML-escape special characters in paths. Keep secrets in `server/.env`, not in the plist. Stop any manually running broker before starting the service to avoid a port conflict.

After saving the edited file as `~/Library/LaunchAgents/com.autofillos.oauth.plist`:

```sh
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.autofillos.oauth.plist"
# Stop/remove the running service before editing or uninstalling it:
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.autofillos.oauth.plist"
```

Use the popup health check after starting it. A changed Node installation path requires updating the plist. Production needs an HTTPS-hosted broker with process supervision, health monitoring and rate limiting; a developer laptop is not a production dependency.

Manual acceptance checks:

1. Connect two distinct test accounts; verify a third cannot be added. Reconnect an existing account without consuming another slot.
2. Focus `<input autocomplete="one-time-code">` on an HTTP(S) page. Send a fresh unread email containing `Your verification code is 001234`. Confirm the displayed account and code, click paste, verify the input value and Gmail read state.
3. Repeat with six adjacent `<input maxlength="1">` fields and with a React controlled input. Confirm input/change handlers run without automatic submission.
4. Send competing messages from related/unrelated sender domains, old messages, and ordinary invoice numbers. Confirm fresh relevant verification messages are preferred.
5. Go offline during polling; restore connectivity before 30 seconds, then test staying offline through the deadline. Retry afterward.
6. Revoke Google authorization and force an access-token refresh (set the stored account's `expiresAt` to `0` in the trusted worker console). Confirm a reconnect prompt and successful recovery.
7. Disconnect one account, navigate/switch tabs during polling, and close/reopen the popup during consent. Confirm no credentials appear in page messages and no stale poll overwrites a new search.

## Troubleshoot a missing field helper

`npm run dev` writes only to `dist-dev/`; keep the Gmail-configured extension loaded from `dist/`. After rebuilding, reload that extension in Chrome **and refresh the verification webpage** to replace old content-script contexts.

Run `npm run test:page` and open `http://127.0.0.1:8788`. Focus the verification field: the helper should appear even with no new email. To test polling, send a fresh unread message to a connected account containing `Your verification code is 123456`, then focus the field within two minutes. This fixture sends no form data.

`npm run test:extension` builds and executes the actual content bundle in a simulated DOM, checking widget mounting, poll messages, code insertion, mark-read and a missing/invalidated Chrome runtime. It does not replace live Chrome/Gmail testing.
