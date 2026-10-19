import { getAccounts, updateAccounts } from './storage';
import type { Account } from '../shared/types';
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const TOKEN_ENDPOINT = import.meta.env.VITE_OAUTH_TOKEN_ENDPOINT;
const SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
interface Tokens { access_token: string; refresh_token?: string; expires_in: number; scope?: string }
export class ReauthError extends Error {}
function randomString() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
export async function challenge(verifier: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  if (!CLIENT_ID || !TOKEN_ENDPOINT) throw new Error('Configure Google OAuth in .env and rebuild the extension.');
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(12_000),
  });
  const result = await response.json();
  if (!response.ok || result.error) {
    if (result.error === 'invalid_grant') throw new ReauthError('Google authorization expired. Reconnect this account.');
    throw new Error('Google token exchange failed. Check the OAuth server configuration or try again.');
  }
  if (!result.access_token || !Number.isFinite(result.expires_in)) throw new Error('Invalid token response.');
  return result;
}
let connecting = false;
export async function connectAccount(expectedEmail?: string) {
  if (connecting) throw new Error('An account connection is already in progress.');
  connecting = true;
  try {
    if (!CLIENT_ID || !TOKEN_ENDPOINT) throw new Error('Configure Google OAuth in .env and rebuild the extension.');
    const accounts = await getAccounts();
    if (accounts.length >= 2 && !accounts.some(a => a.email === expectedEmail)) throw new Error('Disconnect an account first (maximum two).');
    const verifier = randomString();
    const state = randomString();
    const redirectUri = chrome.identity.getRedirectURL('oauth2');
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: redirectUri,
      response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent select_account',
      code_challenge: await challenge(verifier), code_challenge_method: 'S256', state,
      ...(expectedEmail ? { login_hint: expectedEmail } : {}),
    }).toString();
    const callback = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive: true });
    if (!callback) throw new Error('Google sign-in was cancelled.');
    const returned = new URL(callback);
    if (returned.origin + returned.pathname !== redirectUri || returned.searchParams.get('state') !== state) throw new Error('Invalid OAuth callback.');
    if (returned.searchParams.has('error')) throw new Error('Google sign-in was cancelled or access was denied.');
    const code = returned.searchParams.get('code');
    if (!code) throw new Error('Google did not return an authorization code.');
    const tokens = await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri });
    if (tokens.scope && !tokens.scope.split(' ').includes(SCOPE)) throw new Error('Gmail permission is required. Reconnect and allow Gmail access.');
    const profileResponse = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(10_000),
    });
    if (!profileResponse.ok) throw new Error('Could not read the Gmail profile. Enable the Gmail API and grant access.');
    const { emailAddress: email } = await profileResponse.json();
    if (typeof email !== 'string' || !email.includes('@')) throw new Error('Invalid Gmail profile.');
    if (expectedEmail && email !== expectedEmail) throw new Error(`Please reconnect ${expectedEmail} using the same Google account.`);
    await updateAccounts(current => {
      const previous = current.find(a => a.email === email);
      if (!previous && current.length >= 2) throw new Error('Only two accounts can be connected.');
      const refreshToken = tokens.refresh_token || previous?.refreshToken;
      if (!refreshToken) throw new Error('No refresh token received. Remove the app from Google account permissions and reconnect.');
      const account: Account = { email, accessToken: tokens.access_token, refreshToken, expiresAt: Date.now() + tokens.expires_in * 1000, needsReauth: false };
      return [...current.filter(a => a.email !== email), account];
    });
  } finally { connecting = false; }
}
const refreshing = new Map<string, Promise<string>>();
export async function accessToken(email: string, force = false): Promise<string> {
  const existing = refreshing.get(email);
  if (existing) return existing;
  const work = (async () => {
    const account = (await getAccounts()).find(a => a.email === email);
    if (!account) throw new Error('Account disconnected.');
    if (account.needsReauth) throw new ReauthError(`Reconnect ${email} in Autofill OS.`);
    if (!force && account.expiresAt > Date.now() + 60_000) return account.accessToken;
    try {
      const tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: account.refreshToken });
      await updateAccounts(accounts => accounts.map(a => a.email === email && a.refreshToken === account.refreshToken ? {
        ...a, accessToken: tokens.access_token, refreshToken: tokens.refresh_token || a.refreshToken,
        expiresAt: Date.now() + tokens.expires_in * 1000, needsReauth: false,
      } : a));
      if (!(await getAccounts()).some(a => a.email === email)) throw new Error('Account disconnected.');
      return tokens.access_token;
    } catch (error) {
      if (error instanceof ReauthError) await updateAccounts(accounts => accounts.map(a => a.email === email && a.refreshToken === account.refreshToken ? { ...a, needsReauth: true, accessToken: '', expiresAt: 0 } : a));
      throw error;
    }
  })();
  refreshing.set(email, work);
  try { return await work; } finally { refreshing.delete(email); }
}
export async function gmail<T>(email: string, path: string, init: RequestInit = {}): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(email, attempt === 1);
    const response = await fetch(`https://www.googleapis.com/gmail/v1/users/me/${path}`, {
      ...init, headers: { ...init.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: init.signal ?? AbortSignal.timeout(10_000),
    });
    if (response.status === 401 && attempt === 0) continue;
    if (!response.ok) throw new Error(`Gmail request failed (${response.status}).${response.status === 403 ? ' Check Gmail API access and permissions.' : ''}`);
    return response.json();
  }
  throw new ReauthError(`Reconnect ${email} in Autofill OS.`);
}
