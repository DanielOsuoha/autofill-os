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
function plain(text: string) {
  return text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&(?:nbsp|amp|lt|gt|quot);/gi, ' ').replace(/\s+/g, ' ');
}
export function extractCode(message: GmailMessage, domain: string, title: string): { code: string; score: number } | null {
  const header = (name: string) => message.payload?.headers?.find(h => h.name.toLowerCase() === name)?.value || '';
  const subject = header('subject');
  const text = plain(`${subject}\n${body(message.payload)}\n${message.snippet || ''}`).slice(0, 100_000);
  const keywords = /(?:verification|verify|security|authentication|one[ -]?time|passcode|otp|2fa|sign[ -]?in|login|code|pin)/ig;
  const positions = [...text.matchAll(keywords)].map(m => m.index!);
  if (!positions.length) return null;
  // Require a digit in alphanumeric codes: ordinary uppercase words are not OTPs.
  const matches = [...text.matchAll(/\b(\d{4,8}|[A-Z0-9]{6,8})\b/g)].filter(m => /\d/.test(m[0]));
  const sender = header('from').match(/@([a-z0-9.-]+)\b/i)?.[1]?.toLowerCase();
  const normalized = domain.toLowerCase().replace(/^www\./, '');
  const domainMatch = sender && (sender === normalized || sender.endsWith(`.${normalized}`) || normalized.endsWith(`.${sender}`));
  let best: { code: string; score: number } | null = null;
  for (const match of matches) {
    const distance = Math.min(...positions.map(index => Math.abs(index - match.index!)));
    if (distance > 100) continue;
    const score = (domainMatch ? 200 : 0) + (subject.includes(match[0]) ? 30 : 0) + 100 - distance +
      (title && subject.toLowerCase().includes(title.toLowerCase().slice(0, 40)) ? 5 : 0);
    if (!best || score > best.score) best = { code: match[0], score };
  }
  return best;
}
