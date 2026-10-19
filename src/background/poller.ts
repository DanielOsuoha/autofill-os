import { searchMinutes, POLL_TIMEOUT_MS, MAX_CANDIDATES, type SearchMinutes } from '../shared/config';
import { gmail } from './auth';
import { getAccounts } from './storage';
import type { GmailMessage } from './parser';
import { searchMailbox } from './search';
import type { Candidate, PollUpdate } from '../shared/types';
interface Session {
  requestId: string; tabId: number; frameId: number; domain: string; title: string;
  since: number; cache: Map<string, GmailMessage>; warnings: Set<string>;
  lastUpdate?: PollUpdate; controller: AbortController; candidate?: Candidate; candidates?: Candidate[]; expiresAt: number;
}
const sessions = new Map<number, Session>();
type Checkpoint = Pick<Session, 'requestId' | 'tabId' | 'frameId' | 'domain' | 'title' | 'since' | 'expiresAt'>;
const checkpointKey = (id: string) => `otp-poll:${id}`;
interface Receipt { tabId: number; frameId: number; domain: string; requestId: string; candidate: Candidate; candidates: Candidate[]; expiresAt: number }
const receiptKey = (id: string) => `otp-receipt:${id}`;
async function saveReceipt(s: Session) {
  const stored = await chrome.storage.session.get(null);
  const expired = Object.entries(stored).filter(([key, value]) => key.startsWith('otp-receipt:') && value.expiresAt < Date.now()).map(([key]) => key);
  if (expired.length) await chrome.storage.session.remove(expired);
  const receipt: Receipt = { tabId: s.tabId, frameId: s.frameId, domain: s.domain, requestId: s.requestId, candidate: s.candidate!, candidates: s.candidates!, expiresAt: s.expiresAt };
  await chrome.storage.session.set({ [receiptKey(s.requestId)]: receipt });
}
export const POLL_DELAYS = [2000, 2000, 3000, 5000, 8000, 12000];
const emit = (s: Session, update: Omit<PollUpdate, 'type' | 'requestId'>) => {
  s.lastUpdate = { type: 'OTP_STATUS', requestId: s.requestId, ...update };
  return chrome.tabs.sendMessage(s.tabId, s.lastUpdate, { frameId: s.frameId }).catch(() => { stopPoll(s.tabId, s.requestId); });
};
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
    void chrome.storage.session.remove(checkpointKey(session.requestId));
  }
}
export function startPoll(tabId: number, frameId: number, requestId: string, domain: string, title: string, minutes: SearchMinutes = 2, checkpoint?: Checkpoint) {
  if (sessions.get(tabId)?.requestId === requestId) return;
  stopPoll(tabId);
  const session: Session = { tabId, frameId, requestId, domain, title, since: Date.now() - searchMinutes(minutes) * 60_000, cache: new Map(), warnings: new Set(), controller: new AbortController(), expiresAt: Date.now() + POLL_TIMEOUT_MS, ...checkpoint };
  sessions.set(tabId, session);
  const saved: Checkpoint = { tabId, frameId, requestId, domain, title, since: session.since, expiresAt: session.expiresAt };
  void chrome.storage.session.set({ [checkpointKey(requestId)]: saved }).then(() => run(session)).catch(error => {
    if (!session.controller.signal.aborted) void emit(session, { status: 'error', message: error instanceof Error ? error.message : 'Polling failed.' });
  }).finally(() => { if (!session.candidate && sessions.get(tabId) === session) stopPoll(tabId); });
}
async function run(s: Session) {
  const signal = s.controller.signal;
  // A strict wall-clock deadline also aborts in-flight Gmail fetches.
  const deadline = setTimeout(() => s.controller.abort(), Math.max(0, s.expiresAt - Date.now()));
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
      s.warnings.clear();
      for (const account of accounts.filter(a => a.needsReauth)) s.warnings.add(`Reconnect ${account.email} in the popup.`);
      const eligible = accounts.filter(a => !a.needsReauth);
      if (!eligible.length) { await emit(s, { status: 'error', message: 'Reconnect your Gmail accounts in the popup.' }); return; }
      await emit(s, { status: 'polling', message: `Checking ${eligible.length} Gmail account${eligible.length > 1 ? 's' : ''}…` });
      const scans = await Promise.allSettled(eligible.map(a => searchMailbox(a.email, { ...s, signal, warn: message => s.warnings.add(message) })));
      if (signal.aborted) break;
      const candidates = scans.flatMap(r => r.status === 'fulfilled' ? r.value : []);
      const failure = scans.find(r => r.status === 'rejected');
      lastError = failure?.status === 'rejected' ? (failure.reason instanceof Error ? failure.reason.message : 'Gmail unavailable.') : '';
      if (lastError) s.warnings.add(lastError);
      candidates.sort((a, b) => (b.score - (Date.now() - b.receivedAt) / 15000) - (a.score - (Date.now() - a.receivedAt) / 15000) || b.receivedAt - a.receivedAt);
      if (candidates[0]) {
        s.candidates = candidates.slice(0, MAX_CANDIDATES); s.candidate = s.candidates[0]; s.expiresAt = Date.now() + 120_000;
        await saveReceipt(s);
        await chrome.storage.session.remove(checkpointKey(s.requestId));
        if (signal.aborted) return;
        await emit(s, { status: 'found', candidate: s.candidate, candidates: s.candidates, expiresAt: s.expiresAt, warning: [...s.warnings].join(' ') || undefined });
        // Keep only a short-lived receipt to authorize the subsequent mark-as-read.
        setTimeout(() => { if (sessions.get(s.tabId) === s) stopPoll(s.tabId); }, 120_000);
        return;
      }
    }
    if (sessions.get(s.tabId) === s) await emit(s, { status: 'timeout', message: lastError || [...s.warnings].join(' ') || 'No fresh code found within 30 seconds. Try again.' });
  } finally { clearTimeout(deadline); }
}
export async function markRead(tabId: number, frameId: number, domain: string, requestId: string, email: string, messageId: string) {
  // A receipt in storage.session survives MV3 worker suspension without persisting the code to disk.
  const key = receiptKey(requestId);
  const s = (await chrome.storage.session.get(key))[key] as Receipt | undefined;
  if (!s || s.tabId !== tabId || s.frameId !== frameId || s.domain !== domain || s.requestId !== requestId || s.expiresAt < Date.now() ||
      !(s.candidates || [s.candidate]).some(candidate => candidate.email === email && candidate.messageId === messageId)) throw new Error('This code has expired. Search again.');
  await gmail(email, `messages/${encodeURIComponent(messageId)}/modify`, { method: 'POST', body: JSON.stringify({ removeLabelIds: ['UNREAD'] }) });
  await chrome.storage.session.remove(key);
  stopPoll(tabId, requestId);
}

export async function pollState(tabId: number, frameId: number, domain: string, requestId: string): Promise<PollUpdate | null> {
  const current = sessions.get(tabId);
  if (current?.requestId === requestId && current.frameId === frameId && current.domain === domain) return current.lastUpdate || null;
  const stored = await chrome.storage.session.get([receiptKey(requestId), checkpointKey(requestId)]);
  const receipt = stored[receiptKey(requestId)] as Receipt | undefined;
  if (receipt && receipt.tabId === tabId && receipt.frameId === frameId && receipt.domain === domain && receipt.expiresAt > Date.now()) {
    return { type: 'OTP_STATUS', requestId, status: 'found', candidate: receipt.candidate, candidates: receipt.candidates, expiresAt: receipt.expiresAt };
  }
  const checkpoint = stored[checkpointKey(requestId)] as Checkpoint | undefined;
  if (checkpoint && checkpoint.tabId === tabId && checkpoint.frameId === frameId && checkpoint.domain === domain && checkpoint.expiresAt > Date.now()) {
    if (current) return null; // Never replace a newer field's session.
    startPoll(tabId, frameId, requestId, domain, checkpoint.title, 2, checkpoint);
    return { type: 'OTP_STATUS', requestId, status: 'polling', message: 'Resuming interrupted Gmail search…' };
  }
  return null;
}
