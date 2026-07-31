import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountManager } from '../src/accountManager.js';
import { MetadataStore } from '../src/metadataStore.js';
import { ProfileFile } from '../src/profileFile.js';
import type { CredentialStore } from '../src/types.js';

// Mem credential store standing in for the macOS Keychain / Linux file.
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

describe('scenario: log into a new account WITHOUT logging out', () => {
  it('captures the old account, keeps it on login-over, and lets you switch back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clp-scenario-'));
    const profilePath = join(dir, '.claude.json');
    const store = memStore();
    const meta = new MetadataStore({ path: join(dir, 'accounts.json') });
    const profile = new ProfileFile({ path: profilePath });
    const mgr = new AccountManager({ store, meta, profile, config: { logoutBehavior: 'delete-switch' }, now: () => 'T0' });

    // --- 1) Logged into account A in Claude CLI. Then run any claude-p command → reconcile captures A.
    store.canonical = 'CRED_A';
    writeFileSync(profilePath, JSON.stringify({ oauthAccount: { emailAddress: 'a@itr.com', accountUuid: 'UA' } }));
    await mgr.reconcileOnChange();
    expect(store.saved['a@itr.com']).toBe('CRED_A'); // A is now saved inside claude-p
    expect(meta.read().accounts.map((x) => x.name)).toEqual(['a@itr.com']);

    // --- 2) Log into account B in Claude CLI WITHOUT logging out. Claude overwrites the canonical
    //         credential and rewrites ~/.claude.json to B. (This is the "đè" that claude-p guards against.)
    store.canonical = 'CRED_B';
    writeFileSync(profilePath, JSON.stringify({ oauthAccount: { emailAddress: 'b@itr.com', accountUuid: 'UB' } }));
    const res = await mgr.reconcileOnChange();

    // B is auto-captured; A is NOT removed (login-over is not a logout).
    expect(res.autoSaved?.name).toBe('b@itr.com');
    expect(res.removed).toBeNull();
    expect(meta.read().accounts.map((x) => x.name).sort()).toEqual(['a@itr.com', 'b@itr.com']);
    expect(store.saved['a@itr.com']).toBe('CRED_A'); // A's saved credential is untouched

    // --- 3) Switch back to A later. claude-p restores A's credential into the canonical slot.
    await mgr.switchTo('a@itr.com');
    expect(store.canonical).toBe('CRED_A');
    expect(profile.peekLabel()?.email).toBe('a@itr.com'); // /status label restored to A
  });
});
