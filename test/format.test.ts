import { describe, it, expect } from 'vitest';
import { formatRelative, formatList, SYMBOLS } from '../src/format.js';
import { makeColors } from '../src/color.js';
import type { AccountView } from '../src/types.js';

const T = Date.parse('2026-07-31T12:00:00Z');
const plain = makeColors(false);

const view = (email: string, active = false, org?: string, savedAt = 'T'): AccountView => ({
  name: email,
  email,
  organizationName: org,
  savedAt,
  active,
});

describe('format', () => {
  it('formatRelative gives coarse buckets', () => {
    expect(formatRelative('2026-07-31T11:59:30Z', T)).toBe('just now');
    expect(formatRelative('2026-07-31T11:00:00Z', T)).toBe('1h ago');
    expect(formatRelative('2026-07-29T12:00:00Z', T)).toBe('2d ago');
  });

  it('formatRelative covers week/month/year buckets', () => {
    expect(formatRelative('2026-07-10T12:00:00Z', T)).toBe('3w ago');
    expect(formatRelative('2026-06-01T12:00:00Z', T)).toBe('2mo ago');
    expect(formatRelative('2024-07-31T12:00:00Z', T)).toBe('2y ago');
    expect(formatRelative('not-a-date', T)).toBe('—');
  });

  it('numbers accounts by email order and marks the active one', () => {
    const out = formatList([view('b@x.com', false), view('a@x.com', true, 'ITR', '2026-07-29T12:00:00Z')], T, plain);
    const lines = out.split('\n');
    // a@x.com sorts first → index 1, and is active
    expect(out).toContain('claudep · 2 accounts');
    expect(lines.some((l) => l.includes('1') && l.includes(`${SYMBOLS.active} a@x.com`) && l.includes('active'))).toBe(true);
    expect(lines.some((l) => l.includes('2') && l.includes('b@x.com'))).toBe(true);
  });

  it('shows a switch hint when there is more than one account', () => {
    const out = formatList([view('a@x.com', true), view('b@x.com')], T, plain);
    expect(out).toContain('→ claudep');
  });

  it('handles the empty case', () => {
    expect(formatList([], T, plain)).toContain('No saved accounts');
  });

  it('notes an active external login that is not saved yet', () => {
    const out = formatList([view('a@x.com')], T, plain, { external: 'new@x.com' });
    expect(out).toContain('new@x.com');
    expect(out).toMatch(/not saved yet/i);
  });

  it('emits ANSI codes when colors are enabled', () => {
    const out = formatList([view('a@x.com', true)], T, makeColors(true));
    expect(out).toContain('\x1b[');
  });
});
