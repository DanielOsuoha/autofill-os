// Execute the actual production bundle with browser/extension APIs simulated.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
const manifest = JSON.parse(readFileSync(new URL('../dist/manifest.json', import.meta.url)));
const entry = manifest.content_scripts[0];
assert.equal(entry.world, 'ISOLATED');
assert.equal(entry.js.length, 1);
const code = readFileSync(new URL(`../dist/${entry.js[0]}`, import.meta.url), 'utf8');
assert.ok(!code.includes('localhost:5173'));
async function check(runtimeAvailable) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM('<!doctype html><input autocomplete="one-time-code"><button id="other">Other field</button>', {
    url: 'https://example.com/verify', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole,
  });
  const w = dom.window;
  w.requestAnimationFrame = callback => w.setTimeout(() => callback(w.performance.now()), 0);
  w.cancelAnimationFrame = id => w.clearTimeout(id);
  try {
    const messages = []; const listeners = new Set(); let shadow;
    const attachShadow = w.HTMLElement.prototype.attachShadow;
    w.HTMLElement.prototype.attachShadow = function(options) { shadow = attachShadow.call(this, options); return shadow; };
    w.HTMLElement.prototype.getClientRects = () => [{ width: 100, height: 40 }];
    w.ResizeObserver = class { observe() {} disconnect() {} };
    w.chrome = runtimeAvailable ? { runtime: {
      id: 'test-extension',
      onMessage: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) },
      sendMessage: async message => { messages.push(message); return { ok: true, data: null }; },
    } } : {};
    w.eval(code);
    const input = w.document.querySelector('input');
    input.focus();
    async function until(predicate) {
      for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
      throw new Error('Timed out waiting for widget');
    }
    await until(() => shadow?.querySelector('section'));
    if (!runtimeAvailable) {
      await until(() => shadow.querySelector('[role="alert"]'));
      assert.match(shadow.querySelector('[role="alert"]').textContent, /Refresh this page/);
      assert.equal(messages.length, 0);
    } else {
      await until(() => messages.some(m => m.type === 'START_OTP_POLL'));
      const poll = messages.find(m => m.type === 'START_OTP_POLL');
      for (const listener of listeners) listener({ type: 'OTP_STATUS', requestId: poll.requestId, status: 'found', candidate: {
        code: '001234', email: 'test@example.com', messageId: 'test-mail', receivedAt: Date.now(), score: 100,
      } });
      await until(() => shadow.textContent.includes('Paste Code: 001234'));
      const button = [...shadow.querySelectorAll('button')].find(b => b.textContent.includes('Paste Code:'));
      button.click();
      await until(() => messages.some(m => m.type === 'MARK_EMAIL_READ'));
      assert.equal(input.value, '001234');
      assert.equal(messages.find(m => m.type === 'MARK_EMAIL_READ').messageId, 'test-mail');
      // An extension reload while the helper is mounted must also clean up safely.
      input.blur(); input.focus();
      await until(() => listeners.size > 0);
      w.chrome.runtime = undefined;
      w.document.querySelector('#other').focus();
    }
    assert.deepEqual(errors, []);
    console.log(runtimeAvailable ? 'PASS: built widget mounts, polls, pastes and marks read; invalidated-context cleanup succeeds.' : 'PASS: missing Chrome runtime displays a refresh message without crashing.');
  } finally { w.dispatchEvent(new w.Event('pagehide')); w.close(); }
}
await check(true);
await check(false);
