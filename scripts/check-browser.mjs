// Real Chromium, real packaged MV3 worker/content scripts, fake Gmail in a disposable profile.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { build } from 'vite';
const temporary = await mkdtemp(join(tmpdir(), 'autofill-browser-'));
let context;
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/fixture.js' ? await readFile(join(temporary, 'site/fixture.js')) : '<!doctype html><title>Example verification</title><div id="root"></div><script src="/fixture.js"></script>');
});
async function until(check, label) {
  for (let i = 0; i < 150; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}`);
}
try {
  await build({ configFile: false, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, build: {
    outDir: join(temporary, 'site'), lib: { entry: resolve('tests/browser-fixture.jsx'), name: 'Fixture', formats: ['iife'], fileName: () => 'fixture.js' },
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const extension = resolve('dist');
  context = await chromium.launchPersistentContext(join(temporary, 'profile'), {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  // Prevent live API access from page contexts; worker fetch is replaced below.
  await context.route('https://**/*', route => route.abort());
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ accounts: [{ email: 'test@example.com', accessToken: 'fake', refreshToken: 'fake', expiresAt: Date.now() + 3600000 }] });
    globalThis.marked = 0;
    globalThis.fetch = async (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/health') return Response.json({ ok: true });
      if (path.endsWith('/modify')) { globalThis.marked++; return Response.json({}); }
      if (path.endsWith('/messages')) return Response.json({ messages: [{ id: 'fixture-message' }] });
      if (path.endsWith('/messages/fixture-message')) return Response.json({ id: 'fixture-message', internalDate: String(Date.now()), payload: {
        mimeType: 'text/plain', headers: [{ name: 'From', value: 'Example <verify@example.com>' }, { name: 'Subject', value: 'Your verification code' }],
        body: { data: btoa('Your verification code is 001234') },
      } });
      throw new Error('Unexpected test request');
    };
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const cdp = await context.newCDPSession(page);
  // CDP can inspect the extension's closed shadow root without changing production code.
  async function pasteButton(click = false) {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    function text(node) { return (node.nodeValue || '') + (node.children || []).map(text).join(''); }
    function find(node) {
      if (node.nodeName === 'BUTTON' && text(node).includes('Paste Code: 001234')) return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) { const found = find(child); if (found) return found; }
    }
    const button = find(root); if (!button) return false;
    if (click) {
      const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: button.backendNodeId });
      await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function(){this.click()}' });
    }
    return true;
  }
  for (const [field, output] of [['#single', '#single-value'], ['#digit-0', '#split-value']]) {
    await page.locator(field).focus();
    await until(() => pasteButton(), 'Gmail result in closed shadow widget');
    await pasteButton(true);
    await until(async () => (await page.locator(output).textContent()) === '001234', 'React controlled state updated');
    await until(async () => await page.locator('#autofill-os-widget').count() === 0, 'mark-read success closes helper');
  }
  assert.equal(await worker.evaluate(() => globalThis.marked), 2);
  console.log('PASS: real MV3 messaging, Gmail search, React controlled single/split insertion and mark-read.');
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await chrome.tabs.sendMessage(tab.id, { type: 'ARM_MANUAL_SELECTION' });
  });
  await page.locator('#unusual').click();
  await until(() => pasteButton(), 'manual selection finds code');
  await pasteButton(true);
  await until(async () => await page.locator('#unusual').inputValue() === '001234', 'manual selection paste');
  await until(async () => await worker.evaluate(() => globalThis.marked) === 3, 'manual selection marks read');
  await page.reload();
  await page.locator('#single').focus();
  await until(() => pasteButton(), 'navigation installs a fresh content script');
  await page.locator('#single').evaluate(input => input.remove());
  await until(async () => await page.locator('#autofill-os-widget').count() === 0, 'removed input dismisses stale helper');
  assert.deepEqual(errors, []);
  console.log('PASS: manual field selection, page reload recovery, removed-field cleanup; no page errors.');
  const browserCdp = await context.browser().newBrowserCDPSession();
  await worker.evaluate(() => chrome.action.openPopup());
  let popupTarget;
  await until(async () => {
    const { targetInfos } = await browserCdp.send('Target.getTargets');
    popupTarget = targetInfos.find(target => target.url.endsWith('/src/popup/index.html'));
    return Boolean(popupTarget);
  }, 'extension action popup');
  const { sessionId } = await browserCdp.send('Target.attachToTarget', { targetId: popupTarget.targetId, flatten: false });
  let commandId = 0;
  function popupEvaluate(expression) {
    const id = ++commandId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { browserCdp.off('Target.receivedMessageFromTarget', receive); reject(new Error('Popup evaluation timeout')); }, 5000);
      function receive(event) {
        const reply = JSON.parse(event.message);
        if (event.sessionId !== sessionId || reply.id !== id) return;
        clearTimeout(timer); browserCdp.off('Target.receivedMessageFromTarget', receive);
        if (reply.error || reply.result?.exceptionDetails) reject(new Error('Popup evaluation failed'));
        else resolve(reply.result?.result?.value);
      }
      browserCdp.on('Target.receivedMessageFromTarget', receive);
      void browserCdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }) }).catch(reject);
    });
  }
  await until(() => popupEvaluate(`Boolean([...document.querySelectorAll('button')].find(b => b.textContent === 'Check account connection server'))`), 'popup loaded');
  await popupEvaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Check account connection server').click()`);
  await until(async () => {
    const error = await popupEvaluate(`document.querySelector('[role="alert"]')?.textContent`);
    if (error) throw new Error(`Popup health check: ${error}`);
    return await popupEvaluate(`Boolean(document.querySelector('[role="status"]')?.textContent.includes('reachable'))`);
  }, 'popup broker health check');
  console.log('PASS: popup health request reaches the background handler and displays its result.');
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
