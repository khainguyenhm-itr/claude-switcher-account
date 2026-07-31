import { describe, it, expect } from 'vitest';
import { orderAccounts, compareByEmail } from '../src/order.js';
import type { AccountView } from '../src/types.js';

const view = (email: string, active = false): AccountView => ({ name: email, email, savedAt: 'T', active });

describe('orderAccounts', () => {
  it('sorts by email, case-insensitive', () => {
    const out = orderAccounts([view('Charlie@x.com'), view('alice@x.com'), view('Bob@x.com')]);
    expect(out.map((v) => v.email)).toEqual(['alice@x.com', 'Bob@x.com', 'Charlie@x.com']);
  });

  it('order is independent of the active flag', () => {
    const a = orderAccounts([view('b@x.com', true), view('a@x.com', false)]);
    const b = orderAccounts([view('b@x.com', false), view('a@x.com', true)]);
    expect(a.map((v) => v.email)).toEqual(b.map((v) => v.email));
    expect(a.map((v) => v.email)).toEqual(['a@x.com', 'b@x.com']);
  });

  it('does not mutate the input array', () => {
    const input = [view('b@x.com'), view('a@x.com')];
    orderAccounts(input);
    expect(input.map((v) => v.email)).toEqual(['b@x.com', 'a@x.com']);
  });

  it('compareByEmail is a stable comparator on email only', () => {
    expect(compareByEmail({ email: 'a@x.com' }, { email: 'b@x.com' })).toBeLessThan(0);
    expect(compareByEmail({ email: 'b@x.com' }, { email: 'a@x.com' })).toBeGreaterThan(0);
    expect(compareByEmail({ email: 'a@x.com' }, { email: 'A@x.com' })).toBe(0);
  });
});
