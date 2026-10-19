export type FailureCode = 'broker_unavailable' | 'network' | 'rate_limited' | 'permission' | 'reauth' | 'gmail_unavailable';
export class ServiceError extends Error {
  constructor(public code: FailureCode, message: string, public retryAt?: number) { super(message); }
}
export function retryAfter(value: string | null, now = Date.now()): number {
  if (!value) return now + 5000;
  const seconds = Number(value);
  const deadline = Number.isFinite(seconds) ? now + Math.max(0, seconds) * 1000 : Date.parse(value);
  return Number.isFinite(deadline) ? Math.max(now + 1000, deadline) : now + 5000;
}
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}
export function delay(ms: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
