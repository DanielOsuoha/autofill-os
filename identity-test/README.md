# Chrome-native identity experiment

Load this folder directly using stable Google Chrome → chrome://extensions → Developer mode → Load unpacked. No npm build or localhost server is needed. The manifest public key keeps the test extension ID stable when the folder moves. It is not a client secret.

Create a Chrome Extension OAuth client in a separate Google Cloud test project, using the ID displayed by Chrome. Enable Gmail API, configure External / Testing audience, add both test users, and configure the three scopes listed in manifest.json. Replace only oauth2.client_id in this folder's manifest.json with the new public client ID. Do not change the production .env. Reload the extension and click its toolbar icon to open the diagnostic tab.

Use one diagnostic tab at a time. Sign into the intended Google accounts in the test Chrome profile. A Gmail web session alone may not make an account accessible to Chrome identity. This is part of what the experiment tests.

1. Enter A's primary email and connect A. Enter B's primary email and connect B. A wrong account is rejected, never silently saved.
2. If B returns A, use the explicitly labeled reset control, then connect B. Reset clears Chrome's identity state for this extension; it does NOT prove both accounts work. Check A, B, A silently afterward.
3. Use cache eviction for each account. This tests token reacquisition, NOT natural expiration. Repeat silent checks after natural token expiry; getAuthToken does not return an expiry time. A next-day check is useful evidence, not a precise expiry measurement.
4. Fully quit and reopen Chrome, reopen the diagnostic tab, check both accounts silently.
5. Disconnect A locally, verify B still works. Reconnect A. Separately revoke THIS TEST PROJECT's app access from A at https://myaccount.google.com/connections and check both. Cached tokens may not reflect revocation immediately. Do not revoke the production Autofill OS app.
6. Download the result log. It includes email addresses and account IDs but no access tokens or message content. Record the installed Chrome version/channel from chrome://version with your results.

Every check obtains a token for the saved account ID, compares Google userinfo and Gmail profile with the expected identity, and requests one inbox message ID without displaying or saving it. Empty inboxes pass. No email is modified. Tokens stay in Chrome's own identity cache and transient page memory; this app saves only account metadata and results.

The unit checks validate rejection and request logic only. Actual stable Chrome with real consent must establish multi-account behavior. A successful cache-eviction test does not establish natural-expiry behavior, and a successful local disconnect does not establish server-side revocation isolation.

References:
- https://developer.chrome.com/docs/extensions/reference/api/identity
- https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile
