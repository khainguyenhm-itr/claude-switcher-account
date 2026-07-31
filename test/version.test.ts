import { describe, it, expect } from 'vitest';
import { compareVersions, checkForUpdate, formatVersion, VERSION } from '../src/version.js';

function fetchReturning(body: unknown, ok = true): typeof fetch {
  return (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

describe('compareVersions', () => {
  it('orders versions numerically', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.0.1', '1.0.0')).toBe(1);
  });
});

describe('checkForUpdate', () => {
  it('flags a newer published version', async () => {
    const info = await checkForUpdate('1.0.0', 'pkg', fetchReturning({ version: '1.2.0' }));
    expect(info).toEqual({ current: '1.0.0', latest: '1.2.0', isNewer: true });
  });

  it('reports up-to-date when latest equals current', async () => {
    const info = await checkForUpdate('1.2.0', 'pkg', fetchReturning({ version: '1.2.0' }));
    expect(info?.isNewer).toBe(false);
  });

  it('returns null on a non-ok response', async () => {
    expect(await checkForUpdate('1.0.0', 'pkg', fetchReturning({}, false))).toBeNull();
  });

  it('returns null when the request throws (offline)', async () => {
    const throwing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await checkForUpdate('1.0.0', 'pkg', throwing)).toBeNull();
  });
});

describe('formatVersion', () => {
  it('shows the current version header', () => {
    expect(formatVersion(null)).toContain(`claudep ${VERSION}`);
  });
  it('suggests an update when newer is available', () => {
    expect(formatVersion({ current: '1.0.0', latest: '2.0.0', isNewer: true })).toContain('v2.0.0 available');
  });
  it('says up to date otherwise', () => {
    expect(formatVersion({ current: '1.0.0', latest: '1.0.0', isNewer: false })).toContain('up to date');
  });
});
