import { useEffect, useState } from 'react';
import type { PollUpdate } from '../shared/types';
import { request } from '../shared/types';
import type { Target } from './detector';
import { insertCode } from './inject';
export function Widget({ target, onClose }: { target: Target; onClose: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const [update, setUpdate] = useState<PollUpdate>();
  const [requestId, setRequestId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pasted, setPasted] = useState(false);
  useEffect(() => {
    const id = crypto.randomUUID(); let live = true;
    setRequestId(id); setUpdate(undefined); setError(''); setPasted(false);
    const listener = (message: PollUpdate) => {
      if (message.type === 'OTP_STATUS' && message.requestId === id) setUpdate(message);
    };
    chrome.runtime.onMessage.addListener(listener);
    void request({ type: 'START_OTP_POLL', requestId: id, domain: location.hostname, title: document.title })
      .catch(e => { if (live) setError(e.message); });
    // Covers a worker restart, tab switch, or a disconnected message channel.
    const watchdog = setTimeout(() => { if (live) setUpdate(current => current?.status === 'found' ? current : { type: 'OTP_STATUS', requestId: id, status: 'timeout', message: 'Search ended. Try again.' }); }, 32_000);
    return () => {
      live = false; clearTimeout(watchdog); chrome.runtime.onMessage.removeListener(listener);
      void request({ type: 'STOP_OTP_POLL', requestId: id }).catch(() => {});
    };
  }, [attempt]);
  async function paste() {
    if (!update?.candidate) return;
    setBusy(true); setError('');
    try {
      if (!pasted) { insertCode(target, update.candidate.code); setPasted(true); }
      await request({ type: 'MARK_EMAIL_READ', requestId, email: update.candidate.email, messageId: update.candidate.messageId });
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not paste code.'); }
    finally { setBusy(false); }
  }
  return <section aria-label="Autofill OS verification helper" className="w-80 rounded-2xl border border-slate-200 bg-white p-4 font-sans text-sm text-slate-800 shadow-xl">
    <div className="mb-3 flex items-center justify-between"><strong className="text-xs font-bold tracking-widest text-indigo-700">AUTOFILL OS</strong>
      <button onClick={onClose} aria-label="Dismiss code helper" className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100">✕</button></div>
    <div role="status" aria-live="polite">
      {update?.candidate ? <button disabled={busy} onClick={() => void paste()} className="w-full break-words rounded-xl bg-indigo-600 px-4 py-3 text-left font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
        {pasted ? 'Code pasted · Retry marking read' : `Paste Code: ${update.candidate.code}`}
        <span className="mt-1 block text-xs font-normal">({update.candidate.email})</span>
      </button> : <p className="text-slate-600">{update?.message || 'Looking for a fresh verification code…'}</p>}
    </div>
    {pasted && <p className="mt-2 text-xs text-slate-600">Code inserted. Your email will be marked as read.</p>}
    {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    {(error || update?.status === 'timeout' || update?.status === 'error') && <button onClick={() => setAttempt(a => a + 1)} className="mt-3 font-semibold text-indigo-700">Search again</button>}
    <p className="mt-3 text-xs text-slate-400">Gmail codes from the last 2 minutes</p>
  </section>;
}
