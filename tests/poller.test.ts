import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ gmail: vi.fn(), getAccounts: vi.fn() }));
vi.mock('../src/background/auth', () => ({ gmail: mocks.gmail }));
vi.mock('../src/background/storage', () => ({ getAccounts: mocks.getAccounts }));
let messages: Record<string, unknown>[];
let session: Record<string, any>;
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); messages = []; session = {};
  vi.stubGlobal('navigator', { onLine: true });
  const events = new EventTarget();
  vi.stubGlobal('addEventListener', events.addEventListener.bind(events));
  vi.stubGlobal('removeEventListener', events.removeEventListener.bind(events));
  vi.stubGlobal('dispatchEvent', events.dispatchEvent.bind(events));
  vi.stubGlobal('chrome', {
    tabs: { sendMessage: vi.fn(async (_tab, message) => { messages.push(message); }) },
    storage: { session: {
      get: vi.fn(async (key: string | null) => key ? { [key]: session[key] } : session),
      set: vi.fn(async (values) => { Object.assign(session, values); }),
      remove: vi.fn(async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete session[key]; }),
    } },
  });
  mocks.getAccounts.mockResolvedValue([{ email: 'one@example.com' }, { email: 'two@example.com' }]);
  mocks.gmail.mockReset(); mocks.gmail.mockResolvedValue({ messages: [] });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('adaptive polling', () => {
  it('delays the first request and enforces the 30-second deadline', async () => {
    const { startPoll } = await import('../src/background/poller');
    startPoll(1, 0, 'req', 'example.com', 'Sign in');
    await vi.advanceTimersByTimeAsync(1999); expect(mocks.gmail).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(mocks.gmail).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(28_000);
    expect(messages.at(-1)?.status).toBe('timeout');
    expect(mocks.gmail).toHaveBeenCalledTimes(10);
  });
  it('uses the healthy account when the other account fails and persists a receipt', async () => {
    mocks.gmail.mockImplementation(async (email: string, path: string) => {
      if (email === 'one@example.com') throw new Error('Account unavailable');
      if (path.startsWith('messages?')) return { messages: [{ id: 'mail' }] };
      return { id: 'mail', internalDate: String(Date.now()), snippet: 'Your verification code is 123456', payload: { headers: [{ name: 'From', value: 'no-reply@example.com' }] } };
    });
    const { startPoll } = await import('../src/background/poller');
    startPoll(1, 0, 'req', 'example.com', 'Sign in');
    await vi.advanceTimersByTimeAsync(2000);
    expect(messages.at(-1)?.status).toBe('found');
    expect(session['otp-receipt:req'].candidate.email).toBe('two@example.com');
    // Reload the worker module: in-memory sessions no longer exist.
    vi.resetModules();
    const { markRead } = await import('../src/background/poller');
    await expect(markRead(2, 0, 'example.com', 'req', 'two@example.com', 'mail')).rejects.toThrow('expired');
    await markRead(1, 0, 'example.com', 'req', 'two@example.com', 'mail');
    expect(session['otp-receipt:req']).toBeUndefined();
    expect(mocks.gmail).toHaveBeenLastCalledWith('two@example.com', 'messages/mail/modify', expect.objectContaining({ method: 'POST' }));
  });
  it('pauses offline and resumes on an online event within the deadline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const { startPoll } = await import('../src/background/poller');
    startPoll(1, 0, 'offline', 'example.com', '');
    await vi.advanceTimersByTimeAsync(2500);
    expect(mocks.gmail).not.toHaveBeenCalled();
    expect(messages.at(-1)?.status).toBe('offline');
    vi.stubGlobal('navigator', { onLine: true });
    globalThis.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.gmail).toHaveBeenCalledTimes(2);
  });
  it('times out without network calls when offline throughout', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const { startPoll } = await import('../src/background/poller');
    startPoll(1, 0, 'offline', 'example.com', '');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.gmail).not.toHaveBeenCalled();
    expect(messages.at(-1)?.status).toBe('timeout');
  });
  it('cancels a replaced poll', async () => {
    const { startPoll } = await import('../src/background/poller');
    startPoll(1, 0, 'old', 'example.com', '');
    startPoll(1, 0, 'new', 'example.com', '');
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.gmail).toHaveBeenCalledTimes(2);
    expect(messages.filter(m => m.requestId === 'old')).toHaveLength(1);
  });
});
it('only widens the time window when explicitly requested', async () => {
  const now = Date.now();
  const { startPoll } = await import('../src/background/poller');
  startPoll(1, 0, 'wide', 'example.com', '', 5);
  await vi.advanceTimersByTimeAsync(2000);
  const path = mocks.gmail.mock.calls[0][1];
  expect(new URLSearchParams(path.split('?')[1]).get('q')).toBe(`is:unread after:${Math.floor((now - 300000) / 1000)}`);
});
it('offers multiple matches and authorizes only offered message receipts', async () => {
  mocks.getAccounts.mockResolvedValue([{ email: 'one@example.com' }]);
  mocks.gmail.mockImplementation(async (_email, path) => {
    if (path.startsWith('messages?')) return { messages: [{ id: 'a' }, { id: 'b' }] };
    return { internalDate: String(Date.now()), snippet: `Verification code: ${path.includes('/a?') ? '123456' : '654321'}` };
  });
  const { startPoll, markRead } = await import('../src/background/poller');
  startPoll(1, 0, 'choice', 'example.com', '');
  await vi.advanceTimersByTimeAsync(2000);
  expect(messages.at(-1)?.candidates).toHaveLength(2);
  await expect(markRead(1, 0, 'example.com', 'choice', 'one@example.com', 'other')).rejects.toThrow('expired');
  await markRead(1, 0, 'example.com', 'choice', 'one@example.com', 'b');
  expect(mocks.gmail).toHaveBeenLastCalledWith('one@example.com', 'messages/b/modify', expect.anything());
});
