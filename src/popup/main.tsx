import { MAX_ACCOUNTS } from '../shared/config';
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { request, type AccountSummary } from '../shared/types';
import '../shared/styles.css';
function App() {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  async function refresh() { setAccounts(await request<AccountSummary[]>({ type: 'GET_ACCOUNTS' })); }
  useEffect(() => {
    void refresh().catch(e => setError(e.message)).finally(() => setBusy(false));
    const listener = () => { void refresh().catch(e => setError(e.message)); };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);
  async function act(type: 'CONNECT_ACCOUNT' | 'DISCONNECT_ACCOUNT', email?: string) {
    setBusy(true); setError('');
    try {
      const next = type === 'CONNECT_ACCOUNT'
        ? await request<AccountSummary[]>({ type, email })
        : await request<AccountSummary[]>({ type, email: email! });
      setAccounts(next);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to update account.'); }
    finally { setBusy(false); }
  }
  return <main className="w-[380px] bg-slate-50 p-6 font-sans text-slate-900">
    <div className="mb-6 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-indigo-600 text-xl font-bold text-white">A</span><div><h1 className="text-xl font-bold">Autofill OS</h1><p className="text-xs text-slate-500">Your code. One click away.</p></div></div>
    <div className="mb-3 flex justify-between"><h2 className="font-semibold">Connected Gmail accounts</h2><span className="text-sm text-slate-500">{accounts.length}/{MAX_ACCOUNTS}</span></div>
    <div className="space-y-3">{accounts.map(account => <article key={account.email} className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="truncate text-sm font-semibold" title={account.email}>{account.email}</p>
      <p className={`mt-1 text-xs ${account.needsReauth ? 'text-amber-700' : 'text-emerald-700'}`}>{account.needsReauth ? 'Reconnect required' : 'Connected · automatic token refresh'}</p>
      <div className="mt-3 flex gap-4 text-xs"><button disabled={busy} onClick={() => void act('CONNECT_ACCOUNT', account.email)} className="font-semibold text-indigo-700 disabled:opacity-50">Reconnect</button><button disabled={busy} onClick={() => void act('DISCONNECT_ACCOUNT', account.email)} className="text-slate-500 disabled:opacity-50">Disconnect</button></div>
    </article>)}</div>
    {!accounts.length && <p className="mb-4 rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">Connect Gmail to find verification codes when you focus a code field.</p>}
    <button disabled={busy || accounts.length >= MAX_ACCOUNTS} onClick={() => void act('CONNECT_ACCOUNT')} className="mt-4 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">{busy ? 'Please wait…' : accounts.length >= MAX_ACCOUNTS ? 'All account slots connected' : '+ Connect Gmail account'}</button>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
    <div className="mt-6 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-500"><p>Focus a verification field to search unread mail from the last two minutes. Choose a code to paste it and mark its email as read.</p><p className="mt-2">Tokens stay in this browser profile. Disconnect removes local access; revoke Google permissions from your Google account to remove the grant.</p></div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
