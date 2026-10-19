import { gmail } from './auth';
import { getAccounts } from './storage';
import { extractCode, type GmailMessage } from './parser';
import type { Candidate, PollUpdate } from '../shared/types';
interface Session {
  requestId: string; tabId: number; frameId: number; domain: string; title: string;
  controller: AbortController; candidate?: Candidate; expiresAt: number;
}
const sessions = new Map<number, Session>();
interface Receipt { tabId: number; frameId: number; domain: string; requestId: string; candidate: Candidate; expiresAt: number }
const receiptKey = (id: string) => `otp-receipt:${id}`;
async function saveReceipt(s: Session) {
  const stored = await chrome.storage.session.get(null);
  const expired = Object.entries(stored).filter(([key, value]) => key.startsWith('otp-receipt:') && value.expiresAt < Date.now()).map(([key]) => key);
  if (expired.length) await chrome.storage.session.remove(expired);
  const receipt: Receipt = { tabId: s.tabId, frameId: s.frameId, domain: s.domain, requestId: s.requestId, candidate: s.candidate!, expiresAt: s.expiresAt };
  await chrome.storage.session.set({ [receiptKey(s.requestId)]: receipt });
}
export const POLL_DELAYS = [2000, 2000, 3000, 5000, 8000, 12000];
const emit = (s: Session, update: Omit<PollUpdate, 'type' | 'requestId'>) =>
  chrome.tabs.sendMessage(s.tabId, { type: 'OTP_STATUS', requestId: s.requestId, ...update }, { frameId: s.frameId }).catch(() => { stopPoll(s.tabId, s.requestId); });
function pause(ms: number, signal: AbortSignal, wakeOnline = false) {
  return new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); globalThis.removeEventListener('online', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    if (wakeOnline) globalThis.addEventListener('online', done, { once: true });
    if (signal.aborted) done();
  });
}
export function stopPoll(tabId: number, requestId?: string) {
  const session = sessions.get(tabId);
  if (session && (!requestId || session.requestId === requestId)) {
    session.controller.abort(); sessions.delete(tabId);
  }
}
export function startPoll(tabId: number, frameId: number, requestId: string, domain: string, title: string) {
  stopPoll(tabId);
  const session: Session = { tabId, frameId, requestId, domain, title, controller: new AbortController(), expiresAt: Date.now() + 30_000 };
  sessions.set(tabId, session);
  void run(session).catch(error => {
    if (!session.controller.signal.aborted) void emit(session, { status: 'error', message: error instanceof Error ? error.message : 'Polling failed.' });
  }).finally(() => { if (!session.candidate && sessions.get(tabId) === session) stopPoll(tabId); });
}
async function scan(email: string, s: Session): Promise<Candidate[]> {
  const signal = s.controller.signal;
  const list = await gmail<{ messages?: { id: string }[] }>(email,
    `messages?${new URLSearchParams({ q: 'is:unread newer_than:2m', maxResults: '20' })}`, { signal });
  const results: Candidate[] = [];
  // Small batches bound concurrent Gmail requests while retaining per-account parallelism.
  const messages = list.messages || [];
  for (let i = 0; i < messages.length && !signal.aborted; i += 4) {
    const batch = await Promise.all(messages.slice(i, i + 4).map(async ({ id }) => {
      const message = await gmail<GmailMessage>(email, `messages/${encodeURIComponent(id)}?format=full`, { signal });
      const receivedAt = Number(message.internalDate);
      if (!Number.isFinite(receivedAt) || receivedAt < Date.now() - 120_000 || receivedAt > Date.now() + 5000) return null;
      const parsed = extractCode(message, s.domain, s.title);
      return parsed ? { ...parsed, email, messageId: id, receivedAt } : null;
    }));
    results.push(...batch.filter((c): c is Candidate => c !== null));
  }
  return results;
}
async function run(s: Session) {
  const signal = s.controller.signal;
  // A strict wall-clock deadline also aborts in-flight Gmail fetches.
  const deadline = setTimeout(() => s.controller.abort(), 30_000);
  let lastError = '';
  try {
    await emit(s, { status: 'polling', message: 'Looking for a fresh verification code…' });
    for (const delay of POLL_DELAYS) {
      await pause(Math.min(delay, Math.max(0, s.expiresAt - Date.now())), signal);
      if (signal.aborted) break;
      while (!navigator.onLine && !signal.aborted) {
        await emit(s, { status: 'offline', message: 'Offline. Waiting for your connection…' });
        // Workers may not receive online events; also recheck once per second.
        await pause(1000, signal, true);
      }
      if (signal.aborted) break;
      const accounts = await getAccounts();
      if (!accounts.length) { await emit(s, { status: 'error', message: 'Connect a Gmail account in the Autofill OS popup.' }); return; }
      const eligible = accounts.filter(a => !a.needsReauth);
      if (!eligible.length) { await emit(s, { status: 'error', message: 'Reconnect your Gmail accounts in the popup.' }); return; }
      await emit(s, { status: 'polling', message: `Checking ${eligible.length} Gmail account${eligible.length > 1 ? 's' : ''}…` });
      const scans = await Promise.allSettled(eligible.map(a => scan(a.email, s)));
      if (signal.aborted) break;
      const candidates = scans.flatMap(r => r.status === 'fulfilled' ? r.value : []);
      const failure = scans.find(r => r.status === 'rejected');
      if (failure?.status === 'rejected') lastError = failure.reason instanceof Error ? failure.reason.message : 'Gmail unavailable.';
      candidates.sort((a, b) => b.score - a.score || b.receivedAt - a.receivedAt);
      if (candidates[0]) {
        s.candidate = candidates[0]; s.expiresAt = Date.now() + 120_000;
        await saveReceipt(s);
        if (signal.aborted) return;
        await emit(s, { status: 'found', candidate: s.candidate });
        // Keep only a short-lived receipt to authorize the subsequent mark-as-read.
        setTimeout(() => { if (sessions.get(s.tabId) === s) stopPoll(s.tabId); }, 120_000);
        return;
      }
    }
    if (sessions.get(s.tabId) === s) await emit(s, { status: 'timeout', message: lastError || 'No fresh code found within 30 seconds. Try again.' });
  } finally { clearTimeout(deadline); }
}
export async function markRead(tabId: number, frameId: number, domain: string, requestId: string, email: string, messageId: string) {
  // A receipt in storage.session survives MV3 worker suspension without persisting the code to disk.
  const key = receiptKey(requestId);
  const s = (await chrome.storage.session.get(key))[key] as Receipt | undefined;
  if (!s || s.tabId !== tabId || s.frameId !== frameId || s.domain !== domain || s.requestId !== requestId || s.expiresAt < Date.now() ||
      s.candidate.email !== email || s.candidate.messageId !== messageId) throw new Error('This code has expired. Search again.');
  await gmail(email, `messages/${encodeURIComponent(messageId)}/modify`, { method: 'POST', body: JSON.stringify({ removeLabelIds: ['UNREAD'] }) });
  await chrome.storage.session.remove(key);
  stopPoll(tabId, requestId);
}
