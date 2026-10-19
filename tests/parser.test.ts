import { describe, expect, it } from 'vitest';
import { extractCode, type GmailMessage } from '../src/background/parser';
function message(text: string, from = 'security@example.com'): GmailMessage {
  return { id: 'id', internalDate: String(Date.now()), payload: { mimeType: 'multipart/alternative',
    headers: [{ name: 'From', value: from }], parts: [{ mimeType: 'text/plain', body: { data: Buffer.from(text).toString('base64url') } }] } };
}
describe('OTP extraction', () => {
  it('preserves leading zeroes and decodes nested MIME bodies', () => {
    expect(extractCode(message('Your verification code is 001234'), 'example.com', '')?.code).toBe('001234');
  });
  it('extracts mixed alphanumeric codes', () => {
    expect(extractCode(message('Use A3B7C9 to verify your account'), 'example.com', '')?.code).toBe('A3B7C9');
  });
  it('ignores ordinary uppercase words and numbers without context', () => {
    expect(extractCode(message('SECURITY notice'), 'example.com', '')).toBeNull();
    expect(extractCode(message('Invoice 123456'), 'example.com', '')).toBeNull();
  });
  it('ranks matching sender domains ahead of unrelated senders', () => {
    const relevant = extractCode(message('Verification code: 123456', 'no-reply@mail.example.com'), 'example.com', '')!;
    const other = extractCode(message('Verification code: 765432', 'no-reply@notexample.com'), 'example.com', '')!;
    expect(relevant.score).toBeGreaterThan(other.score);
  });
  it('ignores HTML attributes and scripts', () => {
    const msg = message('');
    msg.payload!.parts = [{ mimeType: 'text/html', body: { data: Buffer.from('<script>code 987654</script><b data-id="123456">Your OTP: 654321</b>').toString('base64url') } }];
    expect(extractCode(msg, 'example.com', '')?.code).toBe('654321');
  });
});
it('matches sibling subdomains but not unrelated public or private suffix tenants', async () => {
  const { matchingDomain } = await import('../src/background/parser');
  expect(matchingDomain('mail.example.co.uk', 'login.example.co.uk')).toBe(true);
  expect(matchingDomain('evil.co.uk', 'example.co.uk')).toBe(false);
  expect(matchingDomain('evil.github.io', 'trusted.github.io')).toBe(false);
});
it('favors the explicit OTP over a nearby year and does not trust display names', () => {
  const result = extractCode(message('Security notice 2026. Your verification code is 001234', 'Example security@example.com <sender@evil.com>'), 'example.com', '');
  expect(result?.code).toBe('001234');
  expect(result?.domainMatch).toBe(false);
});
