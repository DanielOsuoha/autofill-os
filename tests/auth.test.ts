import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../src/shared/types';
let accounts: Account[];
const storage = vi.hoisted(() => ({ getAccounts: vi.fn(), updateAccounts: vi.fn() }));
vi.mock('../src/background/storage', () => storage);
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client');
  vi.stubEnv('VITE_OAUTH_TOKEN_ENDPOINT', 'https://broker.test/token');
  accounts = [{ email: 'one@example.com', accessToken: 'old', refreshToken: 'refresh', expiresAt: 0 }];
  storage.getAccounts.mockImplementation(async () => accounts);
  storage.updateAccounts.mockImplementation(async (update: (a: Account[]) => Account[]) => { accounts = update(accounts); });
});
describe('token lifecycle', () => {
  it('deduplicates concurrent refreshes and persists renewed tokens', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'new', expires_in: 3600 })));
    vi.stubGlobal('fetch', fetcher);
    const { accessToken } = await import('../src/background/auth');
    expect(await Promise.all([accessToken(accounts[0].email), accessToken(accounts[0].email)])).toEqual(['new', 'new']);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(accounts[0].accessToken).toBe('new');
    expect(accounts[0].refreshToken).toBe('refresh');
  });
  it('marks invalid refresh grants for reconnection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));
    const { accessToken } = await import('../src/background/auth');
    await expect(accessToken(accounts[0].email)).rejects.toThrow('expired');
    expect(accounts[0].needsReauth).toBe(true);
    expect(accounts[0].accessToken).toBe('');
  });
  it('does not invalidate an account for a transient server failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'server_error' }), { status: 503 })));
    const { accessToken } = await import('../src/background/auth');
    await expect(accessToken(accounts[0].email)).rejects.toThrow('failed');
    expect(accounts[0].needsReauth).not.toBe(true);
  });
  it('does not resurrect an account disconnected during refresh', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      accounts = [];
      return new Response(JSON.stringify({ access_token: 'new', expires_in: 3600 }));
    }));
    const { accessToken } = await import('../src/background/auth');
    await expect(accessToken('one@example.com')).rejects.toThrow('disconnected');
    expect(accounts).toEqual([]);
  });
  it('produces the RFC 7636 S256 PKCE example', async () => {
    const { challenge } = await import('../src/background/auth');
    expect(await challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});
