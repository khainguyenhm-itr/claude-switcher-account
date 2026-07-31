import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountManager } from '../src/accountManager.js';
import { MetadataStore } from '../src/metadataStore.js';
import { ProfileFile } from '../src/profileFile.js';
import type { CredentialStore } from '../src/types.js';

// In-memory credential store for tests.
function memStore(canonical = ''): CredentialStore & { canonical: string; saved: Record<string, string> } {
  return {
    canonical,
    saved: {} as Record<string, string>,
    isAvailable() {
      return true;
    },
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
  };
}

function setup(canonical = '', profileJson?: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'clp-mgr-'));
  const metaPath = join(dir, 'accounts.json');
  const profilePath = join(dir, '.claude.json');
  if (profileJson !== undefined) writeFileSync(profilePath, JSON.stringify(profileJson));
  const store = memStore(canonical);
  const meta = new MetadataStore({ path: metaPath });
  const profile = new ProfileFile({ path: profilePath });
  const mgr = new AccountManager({ store, meta, profile, config: { logoutBehavior: 'delete-switch' }, now: () => 'T0' });
  return { store, meta, profile, mgr };
}

describe('AccountManager core', () => {
  it('saveCurrent stores the blob under the email and upserts metadata', async () => {
    const { store, meta, mgr } = setup('BLOB', { oauthAccount: { emailAddress: 'a@x.com', organizationName: 'ORG' } });
    const view = await mgr.saveCurrent();
    expect(view.name).toBe('a@x.com');
    expect(store.saved['a@x.com']).toBe('BLOB');
    expect(meta.read().accounts[0]).toMatchObject({ name: 'a@x.com', email: 'a@x.com', organizationName: 'ORG' });
  });

  it('saveCurrent refuses when there is no login', async () => {
    const { mgr } = setup('', {});
    await expect(mgr.saveCurrent()).rejects.toThrow(/no current claude login/i);
  });

  it('saveCurrent stores under an explicit name when provided', async () => {
    const { store, meta, mgr } = setup('BLOB', { oauthAccount: { emailAddress: 'a@x.com' } });
    const view = await mgr.saveCurrent('work');
    expect(view.name).toBe('work');
    expect(store.saved['work']).toBe('BLOB');
    expect(meta.read().accounts[0]).toMatchObject({ name: 'work', email: 'a@x.com' });
  });

  it('saveCurrent throws on a stale-email collision instead of overwriting a different account', async () => {
    const { meta, mgr } = setup('BLOB', { oauthAccount: { emailAddress: 'a@x.com' } });
    await meta.update((d) => d.accounts.push({ name: 'a@x.com', email: 'a@x.com', fingerprint: 'OTHER_FP', savedAt: 'T' }));
    await expect(mgr.saveCurrent()).rejects.toThrow(/does not match|stale/i);
  });

  it('switchTo writes the saved blob into the canonical slot and restores the label', async () => {
    const { store, meta, profile, mgr } = setup('CUR', { oauthAccount: { emailAddress: 'cur@x.com' } });
    await meta.update((d) =>
      d.accounts.push({
        name: 'b@x.com',
        email: 'b@x.com',
        fingerprint: 'fp',
        savedAt: 'T',
        oauthAccount: { emailAddress: 'b@x.com' },
      }),
    );
    store.saved['b@x.com'] = 'SAVED_B';
    await mgr.switchTo('b@x.com');
    expect(store.canonical).toBe('SAVED_B');
    expect(profile.peekLabel()?.email).toBe('b@x.com');
  });

  it('switchTo throws when the saved account is missing', async () => {
    const { mgr } = setup('', {});
    await expect(mgr.switchTo('nope@x.com')).rejects.toThrow(/not found/i);
  });

  it('listAccounts marks the identity-matching account active even after token rotation', async () => {
    const { meta, mgr } = setup('ROTATED', { oauthAccount: { accountUuid: 'U1', emailAddress: 'a@x.com' } });
    await meta.update((d) =>
      d.accounts.push({
        name: 'a@x.com',
        email: 'a@x.com',
        fingerprint: 'OLD_FP',
        savedAt: 'T',
        oauthAccount: { accountUuid: 'U1', emailAddress: 'a@x.com' },
      }),
    );
    const [row] = await mgr.listAccounts();
    expect(row.active).toBe(true); // matched by uuid, not fingerprint
  });

  it('removeAccount deletes the credential and metadata entry', async () => {
    const { store, meta, mgr } = setup('', {});
    await meta.update((d) => d.accounts.push({ name: 'a@x.com', email: 'a@x.com', fingerprint: 'f', savedAt: 'T' }));
    store.saved['a@x.com'] = 'X';
    await mgr.removeAccount('a@x.com');
    expect(store.saved['a@x.com']).toBeUndefined();
    expect(meta.read().accounts).toHaveLength(0);
  });

  it('renameAccount moves the credential and relabels metadata', async () => {
    const { store, meta, mgr } = setup('', {});
    await meta.update((d) => {
      d.lastActive = 'a@x.com';
      d.accounts.push({ name: 'a@x.com', email: 'a@x.com', fingerprint: 'f', savedAt: 'T' });
    });
    store.saved['a@x.com'] = 'BLOB';
    await mgr.renameAccount('a@x.com', 'work');
    expect(store.saved).toEqual({ work: 'BLOB' });
    expect(meta.read().accounts[0].name).toBe('work');
    expect(meta.read().lastActive).toBe('work'); // lastActive follows the rename
  });

  it('renameAccount rejects a duplicate target', async () => {
    const { meta, mgr } = setup('', {});
    await meta.update((d) => {
      d.accounts.push({ name: 'a@x.com', email: 'a@x.com', fingerprint: 'f', savedAt: 'T' });
      d.accounts.push({ name: 'b@x.com', email: 'b@x.com', fingerprint: 'g', savedAt: 'T' });
    });
    await expect(mgr.renameAccount('a@x.com', 'b@x.com')).rejects.toThrow(/already exists/i);
  });
});
