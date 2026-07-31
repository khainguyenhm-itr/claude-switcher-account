import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfileFile } from '../src/profileFile.js';

function newFile(contents?: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'clp-prof-'));
  const path = join(dir, '.claude.json');
  if (contents !== undefined) writeFileSync(path, JSON.stringify(contents));
  return { path, profile: new ProfileFile({ path }) };
}

describe('ProfileFile', () => {
  it('peekLabel returns email/displayName/org from oauthAccount', () => {
    const { profile } = newFile({
      oauthAccount: { emailAddress: 'a@x.com', displayName: 'A', organizationName: 'ORG' },
    });
    expect(profile.peekLabel()).toEqual({ email: 'a@x.com', displayName: 'A', organizationName: 'ORG' });
  });

  it('peekLabel returns null when file missing or no email', () => {
    expect(newFile().profile.peekLabel()).toBeNull();
    expect(newFile({ oauthAccount: {} }).profile.peekLabel()).toBeNull();
    expect(newFile('not json' as unknown).profile.peekLabel()).toBeNull();
  });

  it('currentIdentity reads accountUuid and email', () => {
    const { profile } = newFile({ oauthAccount: { accountUuid: 'U', emailAddress: 'a@x.com' } });
    expect(profile.currentIdentity()).toEqual({ uuid: 'U', email: 'a@x.com' });
  });

  it('applyOauthAccount sets the snapshot but preserves other keys', () => {
    const { path, profile } = newFile({ numStartups: 3, oauthAccount: { emailAddress: 'old@x.com' } });
    profile.applyOauthAccount({ emailAddress: 'new@x.com' });
    const d = JSON.parse(readFileSync(path, 'utf8'));
    expect(d.numStartups).toBe(3);
    expect(d.oauthAccount).toEqual({ emailAddress: 'new@x.com' });
  });

  it('applyOauthAccount(undefined) removes oauthAccount', () => {
    const { path, profile } = newFile({ keep: 1, oauthAccount: { emailAddress: 'x' } });
    profile.applyOauthAccount(undefined);
    const d = JSON.parse(readFileSync(path, 'utf8'));
    expect(d.keep).toBe(1);
    expect(d.oauthAccount).toBeUndefined();
  });

  it('applyOauthAccount(undefined) with no file writes nothing', () => {
    const { path, profile } = newFile();
    profile.applyOauthAccount(undefined);
    expect(existsSync(path)).toBe(false);
  });
});
