import { getDomain } from 'tldts';
export interface MessagePart {
  mimeType?: string; body?: { data?: string }; parts?: MessagePart[];
  headers?: { name: string; value: string }[];
}
export interface GmailMessage { id: string; internalDate: string; snippet?: string; payload?: MessagePart }
function decode(data: string) {
  try { return new TextDecoder().decode(Uint8Array.from(atob(data.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))); }
  catch { return ''; }
}
function body(part?: MessagePart): string {
  if (!part) return '';
  const own = part.body?.data && ['text/plain', 'text/html'].includes(part.mimeType || '') ? decode(part.body.data) : '';
  return [own, ...(part.parts ?? []).map(body)].join('\n');
}
export function matchingDomain(sender: string, page: string): boolean {
  const options = { allowPrivateDomains: true };
  const a = getDomain(sender, options); const b = getDomain(page, options);
  return Boolean(a && b && a === b);
}
function plain(text: string) {
  return text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, value: string) => { const n = value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : Number(value); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' '; }).replace(/&(?:nbsp|amp|lt|gt|quot);/gi, ' ').replace(/\s+/g, ' ');
}
export function extractCode(message: GmailMessage, domain: string, title: string): { code: string; score: number; sender: string; subject: string; domainMatch: boolean } | null {
  const header = (name: string) => message.payload?.headers?.find(h => h.name.toLowerCase() === name)?.value || '';
  const subject = header('subject');
  const text = plain(`${subject}\n${body(message.payload)}\n${message.snippet || ''}`).slice(0, 100_000);
  const keywords = /\b(?:verification|verify|security|authentication|one[ -]?time|passcode|otp|2fa|sign[ -]?in|login|code|pin)\b/ig;
  const positions = [...text.matchAll(keywords)].map(m => m.index!);
  if (!positions.length) return null;
  // Require a digit in alphanumeric codes: ordinary uppercase words are not OTPs.
  const matches = [...text.matchAll(/\b(\d{4,8}|[A-Z0-9]{6,8})\b/g)].filter(m => /\d/.test(m[0]));
  const from = header('from');
  const address = from.match(/<([^<>]+)>/)?.[1] || from;
  const sender = address.match(/^[^\s@]+@([a-z0-9.-]+)$/i)?.[1]?.toLowerCase() || '';
  const domainMatch = matchingDomain(sender, domain);
  const titleWords = title.toLowerCase().match(/[a-z]{4,}/g)?.filter(word => !['login', 'signin', 'verification', 'security', 'account', 'code'].includes(word)) || [];
  let best: { code: string; score: number; sender: string; subject: string; domainMatch: boolean } | null = null;
  for (const match of matches) {
    const distance = Math.min(...positions.map(index => Math.abs(index - match.index!)));
    if (distance > 100) continue;
    // Favor a code immediately following an explicit label over nearby dates/IDs.
    const prefix = text.slice(Math.max(0, match.index! - 45), match.index);
    const explicit = /\b(?:code|otp|pin|passcode)(?:\s+is)?[\s:=-]*$/i.test(prefix);
    if (/\d[-/.]$/.test(prefix) || /^[-/.]\d/.test(text.slice(match.index! + match[0].length))) continue;
    const score = (domainMatch ? 200 : 0) + (explicit ? 80 : 0) + (subject.includes(match[0]) ? 30 : 0) + 100 - distance +
      (titleWords.some(word => subject.toLowerCase().includes(word)) ? 15 : 0);
    if (!best || score > best.score) best = { code: match[0], score, sender, subject: subject.slice(0, 160), domainMatch };
  }
  return best;
}
