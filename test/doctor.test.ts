import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDoctor, buildDoctorDeps } from '../src/doctor.js';
import { MetadataStore } from '../src/metadataStore.js';
import { ProfileFile } from '../src/profileFile.js';
import type { CredentialStore } from '../src/types.js';

function store(canonical: string): CredentialStore {
  return {
    isAvailable: () => true,
    readCanonical: async () => canonical,
    writeCanonical: async () => {},
    readSaved: async () => '',
    writeSaved: async () => {},
    deleteSaved: async () => {},
  };
}

function deps(canonical: string, profileJson?: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'clp-doc-'));
  const profilePath = join(dir, '.claude.json');
  if (profileJson !== undefined) writeFileSync(profilePath, JSON.stringify(profileJson));
  return {
    store: store(canonical),
    profile: new ProfileFile({ path: profilePath }),
    meta: new MetadataStore({ path: join(dir, 'accounts.json') }),
    config: { logoutBehavior: 'delete-switch' as const },
    platform: 'darwin' as NodeJS.Platform,
  };
}

describe('runDoctor', () => {
  it('passes when a login is present', async () => {
    const { ok, report } = await runDoctor(deps('BLOB', { oauthAccount: { emailAddress: 'a@x.com' } }));
    expect(ok).toBe(true);
    expect(report).toContain('a@x.com');
    expect(report).toContain('All checks passed');
  });

  it('fails and gives a hint when no canonical login exists', async () => {
    const { ok, report } = await runDoctor(deps('', {}));
    expect(ok).toBe(false);
    expect(report).toMatch(/log in|not found/i);
  });

  it('reports the backend as unavailable on an unsupported platform', async () => {
    const base = deps('', {});
    const unavailable: CredentialStore = { ...base.store, isAvailable: () => false };
    const { ok, report } = await runDoctor({ ...base, store: unavailable });
    expect(ok).toBe(false);
    expect(report).toContain('unavailable');
  });

  it('buildDoctorDeps assembles real dependencies for a given env', () => {
    const home = mkdtempSync(join(tmpdir(), 'clp-dd-'));
    const d = buildDoctorDeps({ platform: 'linux', home, osUsername: 'k' });
    expect(d.platform).toBe('linux');
    expect(d.config.logoutBehavior).toBe('keep');
    expect(typeof d.store.isAvailable).toBe('function');
  });
});
