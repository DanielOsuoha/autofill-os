import type { SearchMinutes } from '../shared/config';
import { useEffect, useState } from 'react';
import type { Candidate, PollUpdate } from '../shared/types';
import { request } from '../shared/types';
import type { Target } from './detector';
import { insertCode, verifyInsertion } from './inject';
export function Widget({ target, onClose }: { target: Target; onClose: () => void }) {
  const [minutes, setMinutes] = useState<SearchMinutes>(2);
  const [attempt, setAttempt] = useState(0);
  const [update, setUpdate] = useState<PollUpdate>();
  const [requestId, setRequestId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pasted, setPasted] = useState<Candidate>();
  useEffect(() => {
    const id = crypto.randomUUID(); let live = true;
    setRequestId(id); setUpdate(undefined); setError(''); setPasted(undefined);
    const runtime = typeof chrome === 'undefined' ? undefined : chrome.runtime;
    if (!runtime?.id || !runtime.onMessage) {
      setError('Autofill OS was reloaded or is unavailable. Refresh this page to reconnect.');
      setUpdate({ type: 'OTP_STATUS', requestId: id, status: 'error', message: 'Refresh this page to activate Autofill OS.' });
      return;
    }
    const listener = (message: PollUpdate) => {
      if (message.type === 'OTP_STATUS' && message.requestId === id) setUpdate(message);
    };
    try {
      runtime.onMessage.addListener(listener);
    } catch {
      setError('Autofill OS was reloaded. Refresh this page to reconnect.');
      setUpdate({ type: 'OTP_STATUS', requestId: id, status: 'error', message: 'Extension connection unavailable.' });
      return;
    }
    void request({ type: 'START_OTP_POLL', requestId: id, domain: location.hostname, title: document.title, minutes })
      .catch(e => { if (live) setError(e.message); });
    // Covers a worker restart, tab switch, or a disconnected message channel.
    let checking = false;
    const heartbeat = setInterval(() => {
      if (checking || !live || document.hidden) return;
      checking = true;
      void request<PollUpdate | null>({ type: 'GET_POLL_STATE', requestId: id }).then(state => {
        if (live && state) setUpdate(state);
      }).catch(e => { if (live) setError(e.message); }).finally(() => { checking = false; });
    }, 5000);
    const watchdog = setTimeout(() => { if (live) setUpdate(current => current?.status === 'found' || current?.status === 'error' || current?.status === 'timeout' ? current : { type: 'OTP_STATUS', requestId: id, status: 'timeout', message: 'Search ended. Try again.' }); }, 32_000);
    return () => {
      live = false; clearTimeout(watchdog); clearInterval(heartbeat);
      // Chrome can invalidate the context while the helper is still mounted.
      try { runtime.onMessage.removeListener(listener); } catch { /* Page refresh restores the context. */ }
      void request({ type: 'STOP_OTP_POLL', requestId: id }).catch(() => {});
    };
  }, [attempt, minutes]);
  async function paste(candidate: Candidate) {
    if (update?.expiresAt && update.expiresAt < Date.now()) { setError('This search result expired. Search again.'); return; }
    if (pasted && (pasted.email !== candidate.email || pasted.messageId !== candidate.messageId)) return;
    setBusy(true); setError('');
    try {
      if (!pasted) {
        insertCode(target, candidate.code);
        // Give controlled inputs a rendering turn to accept or reject the change.
        await new Promise(resolve => setTimeout(resolve, 0));
        verifyInsertion(target, candidate.code);
        setPasted(candidate);
      }
      await request({ type: 'MARK_EMAIL_READ', requestId, email: candidate.email, messageId: candidate.messageId });
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not paste code.'); }
    finally { setBusy(false); }
  }
  return <section aria-label="Autofill OS verification helper" className="w-80 rounded-2xl border border-slate-200 bg-white p-4 font-sans text-sm text-slate-800 shadow-xl">
    <div className="mb-3 flex items-center justify-between"><strong className="text-xs font-bold tracking-widest text-indigo-700">AUTOFILL OS</strong>
      <button onClick={onClose} aria-label="Dismiss code helper" className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100">✕</button></div>
    <div role="status" aria-live="polite">
      {update?.candidate ? <div className="max-h-64 space-y-2 overflow-y-auto">
        <p className="mb-2 text-xs text-slate-600">Choose the code for this website:</p>
        {(update.candidates || [update.candidate]).map(candidate => {
          const wasPasted = pasted?.email === candidate.email && pasted.messageId === candidate.messageId;
          return <button key={`${candidate.email}:${candidate.messageId}`} disabled={busy || Boolean(pasted && !wasPasted)} onClick={() => void paste(candidate)} className="w-full break-words rounded-xl bg-indigo-600 px-4 py-3 text-left font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
            {wasPasted ? 'Code pasted · Retry marking read' : `Paste Code: ${candidate.code}`}
            <span className="mt-1 block text-xs font-normal">({candidate.email})</span>
            <span className="mt-1 block text-xs font-normal">{candidate.sender || 'Sender unavailable'} · {Math.max(0, Math.floor((Date.now() - candidate.receivedAt) / 60000))} min ago</span>
            {candidate.subject && <span className="block text-xs font-normal">{candidate.subject}</span>}
            <span className="block text-xs font-normal">{candidate.domainMatch ? 'Sender domain matches this site' : 'Sender domain does not match — check before pasting'}</span>
          </button>;
        })}
      </div> : <p className="text-slate-600">{update?.message || 'Looking for a fresh verification code…'}</p>}

    </div>
    {pasted && <p className="mt-2 text-xs text-slate-600">Code inserted. Your email will be marked as read.</p>}
    {update?.warning && <p className="mt-2 text-xs text-amber-700">{update.warning}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    {(error || update?.status === 'timeout' || update?.status === 'error') && <button onClick={() => setAttempt(a => a + 1)} className="mt-3 font-semibold text-indigo-700">Search again</button>}
    {(update?.status === 'timeout' || update?.status === 'error') && minutes === 2 && <button onClick={() => setMinutes(5)} className="mt-3 block text-indigo-700">Search the last 5 minutes</button>}
    <p className="mt-3 text-xs text-slate-400">Unread Gmail codes from the last {minutes} minutes</p>
  </section>;
}
