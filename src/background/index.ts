import { connectAccount } from './auth';
import { storageReady, summaries, updateAccounts } from './storage';
import { markRead, startPoll, stopPoll } from './poller';
import type { Request } from '../shared/types';
void storageReady.catch(() => {});
chrome.runtime.onMessage.addListener((message: Request, sender, sendResponse) => {
  const handle = async () => {
    if (sender.id !== chrome.runtime.id || !message || typeof message.type !== 'string') throw new Error('Invalid request.');
    const popup = !sender.tab && sender.url === chrome.runtime.getURL('src/popup/index.html');
    if (['GET_ACCOUNTS', 'CONNECT_ACCOUNT', 'DISCONNECT_ACCOUNT'].includes(message.type) && !popup) throw new Error('Open the extension popup to manage accounts.');
    switch (message.type) {
      case 'GET_ACCOUNTS': return summaries();
      case 'CONNECT_ACCOUNT': await connectAccount(message.email); return summaries();
      case 'DISCONNECT_ACCOUNT':
        await updateAccounts(accounts => accounts.filter(a => a.email !== message.email)); return summaries();
      case 'START_OTP_POLL': {
        if (sender.tab?.id === undefined || !sender.url || typeof message.requestId !== 'string' || message.requestId.length > 100) throw new Error('Invalid page request.');
        const url = new URL(sender.url);
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported page.');
        const tab = await chrome.tabs.get(sender.tab.id);
        if (!tab.active) throw new Error('Focus this tab to look for a code.');
        // Use the browser-authenticated sender URL, not a page-supplied domain.
        startPoll(sender.tab.id, sender.frameId ?? 0, message.requestId, url.hostname, String(message.title || '').slice(0, 200)); return null;
      }
      case 'STOP_OTP_POLL':
        if (sender.tab?.id !== undefined) stopPoll(sender.tab.id, message.requestId); return null;
      case 'MARK_EMAIL_READ':
        if (sender.tab?.id === undefined) throw new Error('Invalid page request.');
        await markRead(sender.tab.id, sender.frameId ?? 0, new URL(sender.url!).hostname, message.requestId, message.email, message.messageId); return null;
      default: throw new Error('Unknown request.');
    }
  };
  void handle().then(data => sendResponse({ ok: true, data }), error => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Request failed.' }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => stopPoll(tabId));
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.status === 'loading') stopPoll(tabId); });
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  void chrome.tabs.query({ windowId }).then(tabs => tabs.forEach(tab => { if (tab.id !== undefined && tab.id !== tabId) stopPoll(tab.id); }));
});
