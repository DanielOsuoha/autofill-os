// Keep the Phase 1 account cap in one place for UI and background enforcement.
export const MAX_ACCOUNTS = 2;
export const SEARCH_MINUTES = [2, 5] as const;
export type SearchMinutes = typeof SEARCH_MINUTES[number];
export function searchMinutes(value: unknown): SearchMinutes { return value === 5 ? 5 : 2; }
export const POLL_TIMEOUT_MS = 30_000;
export const MAX_MESSAGE_PAGES = 4;
export const MESSAGES_PER_PAGE = 25;
export const MAX_CANDIDATES = 5;
