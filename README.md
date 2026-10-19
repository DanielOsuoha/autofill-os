# Autofill OS — Phase 1

Manifest V3 Chrome extension built with Vite, CRXJS, React, TypeScript and Tailwind CSS. Connect up to two Gmail accounts, focus a verification field, and explicitly choose a fresh code to insert. The email is marked read after insertion; forms are never automatically submitted.

## Run locally

Requires Node.js 22.12+ and Chrome 116+.

```sh
npm install
cp .env.example .env
npm run build
```

Load `dist/` with **chrome://extensions → Developer mode → Load unpacked**. The initial build works without credentials, but Gmail connection requires the setup below. Run `npm run dev` for CRXJS development; reload the extension and target tabs after manifest changes. For testing an installable artifact, use `npm run build` and reload `dist/`.

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

- `src/background/auth.ts`: PKCE, OAuth callback validation, Gmail profile lookup, two-account limit, serialized account writes, deduplicated refresh with a 60-second expiry buffer, and reconnect state for invalid refresh grants. Gmail calls retry once on HTTP 401.
- `src/background/poller.ts`: unread mail search (`is:unread newer_than:2m`) across both accounts; waits of 2, 2, 3, 5, 8, 12 seconds, bounded by a 30-second wall-clock deadline including network requests. The final 12-second wait is truncated at that deadline. Offline sessions wait for `online` and recheck connectivity each second, without extending the deadline. One account's failure does not block the other's results.
- `src/background/parser.ts`: decodes nested MIME parts and HTML, validates message timestamps, finds 4–8 digits or 6–8 uppercase alphanumeric characters within 100 characters of verification keywords, and ranks sender-domain matches first. Alphanumeric candidates must contain a digit to avoid treating words such as SECURITY as codes. This is a heuristic; review the account and code before pasting.
- `src/content/detector.ts`: focus and mutation observation, OTP attributes/labels, adjacent groups of 4–8 single-character inputs. Top-level HTTP(S) pages are supported; cross-origin frames, existing page shadow roots, Chrome internal pages and the Chrome Web Store are not covered in Phase 1.
- `src/content/Widget.tsx`: isolated closed Shadow DOM with its own compiled Tailwind styles. A user gesture invokes native prototype setters and bubbling `input`/`change` events. Split code lengths must match exactly. A mark-read failure leaves the pasted code intact and offers a retry.
- `src/popup`: account connection, disconnection, and reconnection. Disconnect deletes local credentials; it does not revoke Google's grant. Revoke that separately in your Google account's third-party app settings.
- `server/index.mjs`: dependency-free confidential OAuth token broker; accepts only authorization-code and refresh-token grants for the configured client.

Tokens are stored in `chrome.storage.local` as requested, with access restricted to `TRUSTED_CONTEXTS`. This is browser-profile storage, not an encrypted credential vault. Content scripts cannot fetch account tokens; account management is accepted only from the extension popup. Short-lived code receipts live in trusted `chrome.storage.session` so mark-read works after MV3 worker suspension. Receipts expire after two minutes and are removed on use or pruned on subsequent detections. Polling stops on tab changes/navigation. Code selection survives worker suspension, but an interrupted active poll must be retried; the widget includes a watchdog for this case.

Manifest permissions: `identity`, `storage`, `activeTab`, `scripting`; API host access for `https://www.googleapis.com/*` and the configured token broker. Declarative content scripts run on HTTP(S) pages to detect fields automatically, so Chrome will display broad site-access permission. Tailwind styles are confined to the popup document and widget shadow root.

Phase 1 scans the newest 20 unread messages per account per attempt. It does not download attachments, paginate high-volume mailboxes, submit forms, or log messages/codes/tokens. Sender-domain ranking is a relevance heuristic, not sender authentication.

## Validation

```sh
npm run typecheck
npm test
npm run build
```

Automated coverage includes MIME/code parsing, domain ranking, field detection, native-setter insertion, split-field mismatch rejection, PKCE, refresh deduplication/failures, account disconnection during refresh, adaptive deadlines, offline recovery, poll cancellation and receipts surviving worker restart. Live Google consent, real Gmail access, and interaction with third-party framework forms require a configured browser session.

Manual acceptance checks:

1. Connect two distinct test accounts; verify a third cannot be added. Reconnect an existing account without consuming another slot.
2. Focus `<input autocomplete="one-time-code">` on an HTTP(S) page. Send a fresh unread email containing `Your verification code is 001234`. Confirm the displayed account and code, click paste, verify the input value and Gmail read state.
3. Repeat with six adjacent `<input maxlength="1">` fields and with a React controlled input. Confirm input/change handlers run without automatic submission.
4. Send competing messages from related/unrelated sender domains, old messages, and ordinary invoice numbers. Confirm fresh relevant verification messages are preferred.
5. Go offline during polling; restore connectivity before 30 seconds, then test staying offline through the deadline. Retry afterward.
6. Revoke Google authorization and force an access-token refresh (set the stored account's `expiresAt` to `0` in the trusted worker console). Confirm a reconnect prompt and successful recovery.
7. Disconnect one account, navigate/switch tabs during polling, and close/reopen the popup during consent. Confirm no credentials appear in page messages and no stale poll overwrites a new search.
