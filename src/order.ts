import type { AccountView } from './types.js';

/** Deterministic order used by both the list display and index resolution, so `claudep <n>`
 *  always points at the same account regardless of which one is active. Sorts by email. */
export function compareByEmail(a: { email: string }, b: { email: string }): number {
  return a.email.toLowerCase().localeCompare(b.email.toLowerCase());
}

export function orderAccounts(views: AccountView[]): AccountView[] {
  return [...views].sort(compareByEmail);
}
