import { describe, it, expect } from 'vitest';
import { formatRelative, formatList, formatCurrent, SYMBOLS } from '../src/format.js';

const T = Date.parse('2026-07-31T12:00:00Z');

describe('format', () => {
  it('formatRelative gives coarse buckets', () => {
    expect(formatRelative('2026-07-31T11:59:30Z', T)).toBe('just now');
    expect(formatRelative('2026-07-31T11:00:00Z', T)).toBe('1h ago');
    expect(formatRelative('2026-07-29T12:00:00Z', T)).toBe('2d ago');
  });

  it('formatList marks the active row and counts accounts', () => {
    const out = formatList(
      [
        { name: 'a@x.com', email: 'a@x.com', organizationName: 'ITR', savedAt: '2026-07-29T12:00:00Z', active: true },
        { name: 'b@x.com', email: 'b@x.com', savedAt: '2026-07-30T12:00:00Z', active: false },
      ],
      T,
    );
    expect(out).toContain(`${SYMBOLS.active} a@x.com`);
    expect(out).toContain('(active)');
    expect(out).toContain('2 accounts');
  });

  it('formatList handles the empty case', () => {
    expect(formatList([], T)).toContain('No saved accounts');
  });

  it('formatCurrent shows the external-login note when unsaved', () => {
    expect(formatCurrent({ saved: null, label: { email: 'x@x.com' } })).toContain('not yet saved');
  });

  it('formatCurrent shows the saved account with display name and org', () => {
    const out = formatCurrent({
      saved: { name: 'a@x.com', email: 'a@x.com', displayName: 'Ba', organizationName: 'ITR', savedAt: 'T', active: true },
      label: null,
    });
    expect(out).toContain(`${SYMBOLS.active} a@x.com`);
    expect(out).toContain('Ba · ITR');
  });

  it('formatCurrent reports no active login when nothing is present', () => {
    expect(formatCurrent({ saved: null, label: null })).toContain('no active Claude login');
  });

  it('formatRelative covers week/month/year buckets', () => {
    expect(formatRelative('2026-07-10T12:00:00Z', T)).toBe('3w ago');
    expect(formatRelative('2026-06-01T12:00:00Z', T)).toBe('2mo ago');
    expect(formatRelative('2024-07-31T12:00:00Z', T)).toBe('2y ago');
    expect(formatRelative('not-a-date', T)).toBe('—');
  });
});
