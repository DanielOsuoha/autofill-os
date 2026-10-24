const $ = (id) => document.getElementById(id);
const normalize = (value) => value.trim().toLowerCase();
let accounts = {};
let results = [];
const manifest = chrome.runtime.getManifest();
$('setup').textContent = `Extension ID: ${chrome.runtime.id}. ${manifest.oauth2.client_id.startsWith('REPLACE_ME') ? 'Set oauth2.client_id in manifest.json, reload the extension, then reopen this page.' : 'Client ID configured.'}`;

async function api(url, token, stage) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store', signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    let error;
    try { error = (await response.json()).error; } catch { /* Non-JSON error response. */ }
    // Only structured error codes: never log response messages, metadata or bodies.
    const codes = [error?.status,
      ...(Array.isArray(error?.errors) ? error.errors.map(item => item?.reason) : []),
      ...(Array.isArray(error?.details) ? error.details.map(item => item?.reason) : [])]
      .filter(code => typeof code === 'string' && /^[A-Za-z][A-Za-z_]{0,79}$/.test(code));
    const reasons = [...new Set(codes)].join(', ') || 'reason unavailable';
    throw new Error(`${stage}: HTTP ${response.status} (${reasons}).`);
  }
  return response.json();
}
async function getToken(id, interactive = false) {
  if (manifest.oauth2.client_id.startsWith('REPLACE_ME')) throw new Error('Configure the test OAuth client ID first.');
  const result = await chrome.identity.getAuthToken({ interactive, ...(id ? { account: { id } } : {}) });
  if (!result.token) throw new Error('Chrome returned no access token.');
  return result.token;
}
async function verify(token, expected) {
  const user = await api('https://www.googleapis.com/oauth2/v2/userinfo', token, 'Google account identity');
  const profile = await api('https://gmail.googleapis.com/gmail/v1/users/me/profile', token, 'Gmail profile');
  if (!user.id || !user.email || user.verified_email !== true || !profile.emailAddress) throw new Error('Google did not return a verified account identity.');
  if (normalize(user.email) !== normalize(expected.email) || normalize(profile.emailAddress) !== normalize(expected.email) || (expected.id && user.id !== expected.id)) {
    throw new Error('ACCOUNT MISMATCH: token does not belong to the intended account. No account was saved.');
  }
  const inbox = await api('https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&maxResults=1', token, 'Gmail inbox');
  return { id: user.id, email: user.email, inboxAccessible: true, inboxHasMessages: Boolean(inbox.messages?.length) };
}
function render() {
  for (const slot of ['A', 'B']) {
    $('saved-' + slot).textContent = accounts[slot] ? `${accounts[slot].email} — ${accounts[slot].id}` : 'Not connected';
  }
  $('results').textContent = results.map((r) => `${r.time} ${r.action} ${r.slot || ''}: ${r.message}`).join('\n');
}
async function record(action, slot, message) {
  results.push({ time: new Date().toISOString(), action, slot, message });
  results = results.slice(-200);
  await chrome.storage.local.set({ accounts, results });
  $('status').textContent = message;
  render();
}
async function act(action, slot) {
  if (action === 'connect') {
    const input = $('email-' + slot);
    if (!input.value || !input.reportValidity()) throw new Error('Enter the expected primary Gmail address first.');
    const expected = { email: normalize(input.value), ...(accounts[slot] ? { id: accounts[slot].id } : {}) };
    const token = await getToken(accounts[slot]?.id, true);
    const verified = await verify(token, expected);
    if (Object.entries(accounts).some(([other, account]) => other !== slot && account.id === verified.id)) throw new Error('This account is already connected in the other slot.');
    accounts[slot] = { id: verified.id, email: verified.email };
    await record(action, slot, `PASS: verified ${verified.email} and read its inbox listing.`);
  } else if (action === 'check' || action === 'fresh') {
    const account = accounts[slot];
    if (!account) throw new Error('Connect this account first.');
    let token = await getToken(account.id);
    if (action === 'fresh') {
      await verify(token, account);
      await chrome.identity.removeCachedAuthToken({ token });
      token = await getToken(account.id);
    }
    await verify(token, account);
    await record(action, slot, `PASS: ${account.email} verified with an explicit account ID and no interactive prompt${action === 'fresh' ? ' after cache eviction (not proof of natural expiration)' : ''}.`);
  } else if (action === 'forget') {
    delete accounts[slot];
    await record(action, slot, 'Local account association removed. Google consent and Chrome token cache are unchanged.');
  } else if (action === 'reset') {
    if (!confirm('Clear this test extension’s cached tokens and account preferences? Saved account identities remain.')) return;
    await chrome.identity.clearAllCachedAuthTokens();
    await record(action, slot, 'Test identity state reset. Connect the missing account, then silently check BOTH saved accounts.');
  } else if (action === 'export') {
    const blob = new Blob([JSON.stringify({ extensionId: chrome.runtime.id, browser: navigator.userAgent, accounts, results }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'identity-test-results.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
for (const button of document.querySelectorAll('button')) {
  button.addEventListener('click', async () => {
    const buttons = document.querySelectorAll('button');
    buttons.forEach((item) => { item.disabled = true; });
    $('status').textContent = 'Working…';
    try {
      await act(button.dataset.action, button.dataset.slot);
    } catch (error) {
      // Never include Google response bodies, tokens or request URLs in results.
      const message = String(error.message || 'Operation failed').replace(/ya29\.[\w.-]+/g, '[redacted]');
      await record(button.dataset.action, button.dataset.slot, `FAIL: ${message}`);
    } finally {
      buttons.forEach((item) => { item.disabled = false; });
      if ($('status').textContent === 'Working…') $('status').textContent = 'Ready';
    }
  });
}
const stored = await chrome.storage.local.get(['accounts', 'results']);
accounts = stored.accounts || {};
results = stored.results || [];
for (const slot of ['A', 'B']) $('email-' + slot).value = accounts[slot]?.email || '';
render();
