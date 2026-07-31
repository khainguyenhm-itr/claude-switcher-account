import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountManager } from '../src/accountManager.js';
import { MetadataStore } from '../src/metadataStore.js';
import { ProfileFile } from '../src/profileFile.js';
import { fingerprint } from '../src/fingerprint.js';
import type { CredentialStore, Config } from '../src/types.js';

function memStore(canonical = '') {
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
  } as CredentialStore & { canonical: string; saved: Record<string, string> };
}

function setup(canonical: string, profileJson: unknown | undefined, config: Config) {
  const dir = mkdtempSync(join(tmpdir(), 'clp-rec-'));
  const profilePath = join(dir, '.claude.json');
  if (profileJson !== undefined) writeFileSync(profilePath, JSON.stringify(profileJson));
  const store = memStore(canonical);
  const meta = new MetadataStore({ path: join(dir, 'accounts.json') });
  const profile = new ProfileFile({ path: profilePath });
  const mgr = new AccountManager({ store, meta, profile, config, now: () => 'T0' });
  return { dir, profilePath, store, meta, profile, mgr };
}

describe('reconcileOnChange', () => {
  it('auto-saves a brand-new login and records lastActive', async () => {
    const { meta, mgr } = setup('BLOB', { oauthAccount: { emailAddress: 'new@x.com' } }, { logoutBehavior: 'delete-switch' });
    const res = await mgr.reconcileOnChange();
    expect(res.autoSaved?.name).toBe('new@x.com');
    expect(meta.read().lastActive).toBe('new@x.com');
  });

  it('refreshes the stored credential when the active token rotated', async () => {
    const { store, meta, mgr } = setup(
      'ROTATED',
      { oauthAccount: { accountUuid: 'U', emailAddress: 'a@x.com' } },
      { logoutBehavior: 'none' },
    );
    await meta.update((d) =>
      d.accounts.push({
        name: 'a@x.com',
        email: 'a@x.com',
        fingerprint: 'OLD',
        savedAt: 'T',
        oauthAccount: { accountUuid: 'U', emailAddress: 'a@x.com' },
      }),
    );
    await mgr.reconcileOnChange();
    expect(store.saved['a@x.com']).toBe('ROTATED');
    expect(meta.read().accounts[0].fingerprint).toBe(fingerprint('ROTATED'));
  });

  it('delete-switch: logout removes the account and switches to the newest remaining', async () => {
    const { store, meta, profile, profilePath, mgr } = setup(
      'CUR',
      { oauthAccount: { emailAddress: 'a@x.com' } },
      { logoutBehavior: 'delete-switch' },
    );
    await meta.update((d) => {
      d.lastActive = 'a@x.com';
      d.accounts.push({
        name: 'a@x.com',
        email: 'a@x.com',
        fingerprint: fingerprint('CUR'),
        savedAt: '2026-01-01',
        oauthAccount: { emailAddress: 'a@x.com' },
      });
      d.accounts.push({
        name: 'b@x.com',
        email: 'b@x.com',
        fingerprint: 'fb',
        savedAt: '2026-02-01',
        oauthAccount: { emailAddress: 'b@x.com' },
      });
    });
    store.saved['b@x.com'] = 'BLOB_B';
    // simulate logout: canonical gone AND profile gone
    (store as { canonical: string }).canonical = '';
    rmSync(profilePath);
    const res = await mgr.reconcileOnChange();
    expect(res.removed).toBe('a@x.com');
    expect(res.switchedTo).toBe('b@x.com');
    expect(store.canonical).toBe('BLOB_B');
    expect(meta.read().accounts.map((a) => a.name)).toEqual(['b@x.com']);
    expect(profile.peekLabel()?.email).toBe('b@x.com'); // label restored on the switch
  });

  it('keep: logout keeps the account and does not switch', async () => {
    const { store, meta, profilePath, mgr } = setup(
      'CUR',
      { oauthAccount: { emailAddress: 'a@x.com' } },
      { logoutBehavior: 'keep' },
    );
    await meta.update((d) => {
      d.lastActive = 'a@x.com';
      d.accounts.push({ name: 'a@x.com', email: 'a@x.com', fingerprint: 'fa', savedAt: 'T' });
    });
    (store as { canonical: string }).canonical = '';
    rmSync(profilePath);
    const res = await mgr.reconcileOnChange();
    expect(res.removed).toBeNull();
    expect(res.switchedTo).toBeNull();
    expect(meta.read().accounts).toHaveLength(1); // account kept
  });

  it('does NOT remove on a login-over (switch to a known account)', async () => {
    const { meta, mgr } = setup(
      'BLOB_B',
      { oauthAccount: { emailAddress: 'b@x.com' } },
      { logoutBehavior: 'delete-switch' },
    );
    await meta.update((d) => {
      d.lastActive = 'a@x.com';
      d.accounts.push({
        name: 'b@x.com',
        email: 'b@x.com',
        fingerprint: fingerprint('BLOB_B'),
        savedAt: 'T',
        oauthAccount: { emailAddress: 'b@x.com' },
      });
    });
    const res = await mgr.reconcileOnChange();
    expect(res.removed).toBeNull();
    expect(meta.read().lastActive).toBe('b@x.com');
  });

  it('keep-switch: logout keeps the account and switches to another', async () => {
    const { store, meta, profilePath, mgr } = setup(
      'CUR',
      { oauthAccount: { emailAddress: 'a@x.com' } },
      { logoutBehavior: 'keep-switch' },
    );
    await meta.update((d) => {
      d.lastActive = 'a@x.com';
      d.accounts.push({ name: 'a@x.com', email: 'a@x.com', fingerprint: fingerprint('CUR'), savedAt: '2026-01-01' });
      d.accounts.push({
        name: 'b@x.com',
        email: 'b@x.com',
        fingerprint: 'fb',
        savedAt: '2026-02-01',
        oauthAccount: { emailAddress: 'b@x.com' },
      });
    });
    store.saved['b@x.com'] = 'BLOB_B';
    (store as { canonical: string }).canonical = '';
    rmSync(profilePath);
    const res = await mgr.reconcileOnChange();
    expect(res.removed).toBeNull();
    expect(res.switchedTo).toBe('b@x.com');
    expect(store.canonical).toBe('BLOB_B');
    expect(meta.read().accounts.map((a) => a.name).sort()).toEqual(['a@x.com', 'b@x.com']); // both kept
  });

  it('never throws when the platform is unsupported', async () => {
    const { store, mgr } = setup('', {}, { logoutBehavior: 'none' });
    (store as unknown as { isAvailable(): boolean }).isAvailable = () => false;
    await expect(mgr.reconcileOnChange()).resolves.toEqual({ autoSaved: null, removed: null, switchedTo: null });
  });
});
