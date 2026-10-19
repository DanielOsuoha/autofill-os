import { gmail } from './auth';
import { extractCode, type GmailMessage } from './parser';
import { MAX_MESSAGE_PAGES, MESSAGES_PER_PAGE } from '../shared/config';
import type { Candidate } from '../shared/types';
export function recentQuery(since: number) { return `is:unread after:${Math.floor(since / 1000)}`; }
export interface SearchContext {
  since: number; domain: string; title: string; signal: AbortSignal;
  cache: Map<string, GmailMessage>; warn: (message: string) => void;
}
export async function searchMailbox(email: string, context: SearchContext): Promise<Candidate[]> {
  const { signal, cache, since, domain, title, warn } = context;
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_MESSAGE_PAGES; page++) {
    signal.throwIfAborted();
    const query = new URLSearchParams({ q: recentQuery(since), maxResults: String(MESSAGES_PER_PAGE), ...(pageToken ? { pageToken } : {}) });
    let list: { messages?: { id: string }[]; nextPageToken?: string };
    try { list = await gmail(email, `messages?${query}`, { signal }); }
    catch (error) {
      signal.throwIfAborted();
      if (!candidates.length) throw error;
      warn(`${email}: Some mail could not be checked. ${error instanceof Error ? error.message : 'Search again shortly.'}`);
      return candidates;
    }
    const ids = (list.messages || []).map(m => m.id).filter(id => !seen.has(id));
    ids.forEach(id => seen.add(id));
    for (let offset = 0; offset < ids.length; offset += 4) {
      signal.throwIfAborted();
      const results = await Promise.allSettled(ids.slice(offset, offset + 4).map(async id => {
        const key = `${email}:${id}`;
        let message = cache.get(key);
        if (!message) {
          message = await gmail<GmailMessage>(email, `messages/${encodeURIComponent(id)}?format=full`, { signal });
          cache.set(key, message);
        }
        const receivedAt = Number(message.internalDate);
        if (!Number.isFinite(receivedAt) || receivedAt < since || receivedAt > Date.now() + 5000) return null;
        const parsed = extractCode(message, domain, title);
        return parsed ? { ...parsed, email, messageId: id, receivedAt } : null;
      }));
      for (const result of results) {
        if (result.status === 'fulfilled') { if (result.value) candidates.push(result.value); }
        else {
          signal.throwIfAborted();
          warn(`${email}: ${result.reason instanceof Error ? result.reason.message : 'Some messages could not be read.'}`);
        }
      }
    }
    pageToken = list.nextPageToken;
    if (!pageToken) break;
  }
  if (pageToken) warn(`${email}: Search reached its ${MAX_MESSAGE_PAGES * MESSAGES_PER_PAGE}-message limit. Some mail was not checked.`);
  return candidates;
}
