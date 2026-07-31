import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountManager } from '../src/accountManager.js';
import { MetadataStore } from '../src/metadataStore.js';
import { ProfileFile } from '../src/profileFile.js';
import type { CredentialStore } from '../src/types.js';

function memStore() {
  return {
    canonical: '',
    saved: {} as Record<string, string>,
    isAvailable: () => true,
    async readCanonical() {
      return this.canonical;
    },
    async writeCanonical(b: string) {
      this.canonical = b;
    },
    async readSaved(n: string) {
      return this.saved[n] ?? '';
    },
    async writeSaved(n: string, b: string) {
      this.saved[n] = b;
    },
    async deleteSaved(n: string) {
      delete this.saved[n];
    },
  } as CredentialStore & { canonical: string; saved: Record<string, string> };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'clp-resolve-'));
  const meta = new MetadataStore({ path: join(dir, 'accounts.json') });
  const profile = new ProfileFile({ path: join(dir, '.claude.json') });
  const mgr = new AccountManager({ store: memStore(), meta, profile, config: { logoutBehavior: 'none' }, now: () => 'T' });
  return { meta, mgr };
}

describe('AccountManager.resolveByIndex', () => {
  it('maps a 1-based index to the account name in email order', async () => {
    const { meta, mgr } = setup();
    await meta.update((d) => {
      d.accounts.push({ name: 'b@x.com', email: 'b@x.com', fingerprint: 'f', savedAt: 'T' });
      d.accounts.push({ name: 'a@x.com', email: 'a@x.com', fingerprint: 'g', savedAt: 'T' });
    });
    expect(await mgr.resolveByIndex(1)).toBe('a@x.com'); // a sorts before b
    expect(await mgr.resolveByIndex(2)).toBe('b@x.com');
  });

  it('returns null for an out-of-range or non-positive index', async () => {
    const { meta, mgr } = setup();
    await meta.update((d) => d.accounts.push({ name: 'a@x.com', email: 'a@x.com', fingerprint: 'f', savedAt: 'T' }));
    expect(await mgr.resolveByIndex(2)).toBeNull();
    expect(await mgr.resolveByIndex(0)).toBeNull();
  });
});
