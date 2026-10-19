import type { SearchMinutes } from './config';
export interface Account {
  email: string; accessToken: string; refreshToken: string; expiresAt: number; needsReauth?: boolean;
}
export type AccountSummary = Pick<Account, 'email' | 'expiresAt' | 'needsReauth'>;
export interface Candidate { code: string; email: string; messageId: string; score: number; receivedAt: number; sender?: string; subject?: string; domainMatch?: boolean }
export type PollStatus = 'polling' | 'offline' | 'found' | 'timeout' | 'error';
export interface PollUpdate { type: 'OTP_STATUS'; requestId: string; status: PollStatus; message?: string; candidate?: Candidate; candidates?: Candidate[]; warning?: string; expiresAt?: number }
export type Request =
  | { type: 'GET_ACCOUNTS' }
  | { type: 'CHECK_CONNECTION_SERVER' }
  | { type: 'CHOOSE_CODE_FIELD' }
  | { type: 'CONNECT_ACCOUNT'; email?: string }
  | { type: 'DISCONNECT_ACCOUNT'; email: string }
  | { type: 'START_OTP_POLL'; requestId: string; domain: string; title: string; minutes?: SearchMinutes }
  | { type: 'STOP_OTP_POLL'; requestId: string }
  | { type: 'GET_POLL_STATE'; requestId: string }
  | { type: 'MARK_EMAIL_READ'; requestId: string; email: string; messageId: string };
export type Reply<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
export async function request<T>(message: Request): Promise<T> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id || !chrome.runtime?.sendMessage) {
    throw new Error('Autofill OS was reloaded. Refresh this page to reconnect.');
  }
  const reply: Reply<T> = await chrome.runtime.sendMessage(message);
  if (!reply?.ok) throw new Error(reply?.error || 'Extension unavailable. Reload this page.');
  return reply.data;
}
