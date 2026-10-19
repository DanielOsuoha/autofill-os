import type { Account } from '../shared/types';
// Content scripts must never read OAuth credentials directly.
export const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
let writes: Promise<unknown> = Promise.resolve();
export async function getAccounts(): Promise<Account[]> {
  await storageReady;
  return (await chrome.storage.local.get('accounts')).accounts ?? [];
}
export function updateAccounts(update: (accounts: Account[]) => Account[]): Promise<void> {
  const next = writes.then(async () => {
    const accounts = update(await getAccounts());
    await chrome.storage.local.set({ accounts });
  });
  writes = next.catch(() => {});
  return next;
}
export async function summaries() {
  return (await getAccounts()).map(({ email, expiresAt, needsReauth }) => ({ email, expiresAt, needsReauth }));
}
