import { beforeEach, expect, it, vi } from 'vitest';
const gmail = vi.hoisted(() => vi.fn());
vi.mock('../src/background/auth', () => ({ gmail }));
import { recentQuery, searchMailbox } from '../src/background/search';
const context = () => ({ since: Date.now() - 120_000, domain: 'example.com', title: '', signal: new AbortController().signal, cache: new Map(), warn: vi.fn() });
beforeEach(() => { gmail.mockReset(); });
it('uses seconds rather than Gmail month-relative syntax', () => {
  expect(recentQuery(1_700_000_000_999)).toBe('is:unread after:1700000000');
});
it('paginates, rejects old mail, and reuses message bodies within a search', async () => {
  gmail.mockImplementation(async (_email, path) => {
    if (path.startsWith('messages?')) return path.includes('pageToken=next') ? { messages: [{ id: 'fresh' }] } : { messages: [{ id: 'old' }], nextPageToken: 'next' };
    return { id: path, internalDate: String(Date.now() - (path.includes('old') ? 600_000 : 0)), snippet: 'Verification code: 001234' };
  });
  const ctx = context();
  expect(await searchMailbox('a@example.com', ctx)).toMatchObject([{ messageId: 'fresh', code: '001234' }]);
  await searchMailbox('a@example.com', ctx);
  expect(gmail.mock.calls.filter(([, path]) => !path.startsWith('messages?'))).toHaveLength(2);
});
it('retains a valid code when another message fetch fails', async () => {
  gmail.mockImplementation(async (_email, path) => {
    if (path.startsWith('messages?')) return { messages: [{ id: 'gone' }, { id: 'good' }] };
    if (path.includes('gone')) throw new Error('Message no longer available');
    return { internalDate: String(Date.now()), snippet: 'Your OTP is 123456' };
  });
  const ctx = context();
  expect(await searchMailbox('a@example.com', ctx)).toHaveLength(1);
  expect(ctx.warn).toHaveBeenCalled();
});
it('caps pagination and reports incomplete search', async () => {
  gmail.mockResolvedValue({ nextPageToken: 'more' });
  const ctx = context();
  await searchMailbox('a@example.com', ctx);
  expect(gmail).toHaveBeenCalledTimes(4);
  expect(ctx.warn).toHaveBeenCalledWith(expect.stringContaining('message limit'));
});
it('preserves an earlier page match if a later page is throttled', async () => {
  gmail.mockImplementation(async (_email, path) => {
    if (path.includes('pageToken=next')) throw new Error('Gmail rate limit');
    if (path.startsWith('messages?')) return { messages: [{ id: 'good' }], nextPageToken: 'next' };
    return { internalDate: String(Date.now()), snippet: 'Verification code: 123456' };
  });
  const ctx = context();
  expect(await searchMailbox('a@example.com', ctx)).toMatchObject([{ messageId: 'good' }]);
  expect(ctx.warn).toHaveBeenCalledWith(expect.stringContaining('rate limit'));
});
