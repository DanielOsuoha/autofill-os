import { expect, it } from 'vitest';
import { abortable, retryAfter } from '../src/background/network';
it('respects both Retry-After formats', () => {
  expect(retryAfter('12', 1000)).toBe(13000);
  expect(retryAfter('Thu, 01 Jan 1970 00:01:00 GMT', 1000)).toBe(60000);
  expect(retryAfter('bad', 1000)).toBe(6000);
});
it('allows a poll to abort while a shared refresh is still pending', async () => {
  const controller = new AbortController();
  const wait = abortable(new Promise(() => {}), controller.signal);
  controller.abort(new Error('deadline'));
  await expect(wait).rejects.toThrow('deadline');
});
