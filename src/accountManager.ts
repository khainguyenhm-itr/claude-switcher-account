import type { CredentialStore, AccountMeta, AccountView, OauthLabel, Config } from './types.js';
import type { MetadataStore } from './metadataStore.js';
import type { ProfileFile } from './profileFile.js';
import { fingerprint } from './fingerprint.js';

export interface AccountManagerDeps {
  store: CredentialStore;
  meta: MetadataStore;
  profile: ProfileFile;
  config: Config;
  now?: () => string;
}

function toView(a: AccountMeta, active: boolean): AccountView {
  return {
    name: a.name,
    email: a.email,
    displayName: a.displayName,
    organizationName: a.organizationName,
    savedAt: a.savedAt,
    active,
  };
}

export class AccountManager {
  protected readonly store: CredentialStore;
  protected readonly meta: MetadataStore;
  protected readonly profile: ProfileFile;
  protected readonly config: Config;
  protected readonly now: () => string;

  constructor(deps: AccountManagerDeps) {
    this.store = deps.store;
    this.meta = deps.meta;
    this.profile = deps.profile;
    this.config = deps.config;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  protected matchByIdentity(accounts: AccountMeta[], id: { uuid?: string; email?: string }): AccountMeta | undefined {
    if (id.uuid) {
      const m = accounts.find((a) => (a.oauthAccount?.accountUuid as string | undefined) === id.uuid);
      if (m) return m;
    }
    if (id.email) return accounts.find((a) => a.email === id.email);
    return undefined;
  }

  async saveCurrent(name?: string): Promise<AccountView> {
    const blob = await this.store.readCanonical();
    if (!blob) throw new Error('No current Claude login found.');
    const fp = fingerprint(blob);
    const data = this.meta.read();
    const label = this.profile.peekLabel();

    let finalName = name;
    let matched: AccountMeta | undefined;
    if (!finalName) {
      matched = data.accounts.find((a) => a.fingerprint === fp);
      finalName = matched?.name;
    }
    if (!finalName) {
      const email = label?.email;
      const collision = email ? data.accounts.find((a) => a.name === email && a.fingerprint !== fp) : undefined;
      if (collision) {
        throw new Error(
          `Current login does not match saved account '${email}'. Its profile may be stale — retry after the session initializes.`,
        );
      }
      finalName = email;
    }
    if (!finalName) throw new Error('Could not determine an account name.');

    await this.store.writeSaved(finalName, blob);
    const email = matched ? matched.email : (label?.email ?? finalName);
    const current = this.profile.peekOauthAccount();
    const currentEmail = typeof current?.emailAddress === 'string' ? current.emailAddress : undefined;
    const oauthAccount = current && (currentEmail === email || currentEmail === finalName) ? current : matched?.oauthAccount;

    const entry: AccountMeta = {
      name: finalName,
      email: matched ? matched.email : (label?.email ?? finalName),
      displayName: matched ? matched.displayName : label?.displayName,
      organizationName: matched ? matched.organizationName : label?.organizationName,
      fingerprint: fp,
      savedAt: this.now(),
      oauthAccount,
    };
    const nameToWrite = finalName;
    await this.meta.update((d) => {
      d.accounts = [...d.accounts.filter((a) => a.name !== nameToWrite), entry];
    });
    return toView(entry, true);
  }

  async switchTo(name: string): Promise<void> {
    const blob = (await this.store.readSaved(name)).trim();
    if (!blob) throw new Error(`Saved account '${name}' not found.`);
    await this.store.writeCanonical(blob);
    const saved = this.meta.read().accounts.find((a) => a.name === name);
    this.profile.applyOauthAccount(saved?.oauthAccount);
  }

  async removeAccount(name: string): Promise<void> {
    await this.store.deleteSaved(name);
    await this.meta.update((d) => {
      d.accounts = d.accounts.filter((a) => a.name !== name);
      if (d.lastActive === name) d.lastActive = undefined;
    });
  }

  async renameAccount(oldName: string, newName: string): Promise<void> {
    const data = this.meta.read();
    const entry = data.accounts.find((a) => a.name === oldName);
    if (!entry) throw new Error(`Saved account '${oldName}' not found.`);
    if (data.accounts.some((a) => a.name === newName)) throw new Error(`Account '${newName}' already exists.`);
    const blob = await this.store.readSaved(oldName);
    if (blob) await this.store.writeSaved(newName, blob);
    await this.store.deleteSaved(oldName);
    await this.meta.update((d) => {
      d.accounts = d.accounts.map((a) => (a.name === oldName ? { ...a, name: newName } : a));
      if (d.lastActive === oldName) d.lastActive = newName;
    });
  }

  async listAccounts(): Promise<AccountView[]> {
    const accounts = this.meta.read().accounts;
    const id = this.profile.currentIdentity();
    const byId = id.uuid || id.email ? this.matchByIdentity(accounts, id) : undefined;
    let activeFp: string | null = null;
    if (!byId) {
      const blob = await this.store.readCanonical();
      activeFp = blob ? fingerprint(blob) : null;
    }
    return accounts.map((a) => toView(a, byId ? a.name === byId.name : activeFp !== null && a.fingerprint === activeFp));
  }

  current(): { saved: AccountView | null; label: OauthLabel | null } {
    const label = this.profile.peekLabel();
    const accounts = this.meta.read().accounts;
    const byId = this.matchByIdentity(accounts, this.profile.currentIdentity());
    return { saved: byId ? toView(byId, true) : null, label };
  }

  protected async refreshStoredCredential(name: string, blob: string, fp: string): Promise<void> {
    try {
      await this.store.writeSaved(name, blob);
    } catch {
      return;
    }
    await this.meta.update((d) => {
      const idx = d.accounts.findIndex((a) => a.name === name);
      if (idx < 0) return;
      const cur = d.accounts[idx];
      d.accounts[idx] = {
        ...cur,
        fingerprint: fp,
        oauthAccount: this.profile.peekOauthAccount() ?? cur.oauthAccount,
        savedAt: this.now(),
      };
    });
  }

  async autoSaveIfNewLogin(): Promise<AccountView | null> {
    if (!this.store.isAvailable()) return null;
    let blob = '';
    try {
      blob = await this.store.readCanonical();
    } catch {
      return null;
    }
    if (!blob) return null;
    const fp = fingerprint(blob);
    if (this.meta.read().accounts.some((a) => a.fingerprint === fp)) return null; // already saved / just switched
    if (!this.profile.peekLabel()?.email) return null; // no email yet → capture on the next command
    try {
      return await this.saveCurrent();
    } catch {
      return null;
    }
  }

  private pickNext(exclude: string | undefined): AccountMeta | undefined {
    return [...this.meta.read().accounts]
      .filter((a) => a.name !== exclude)
      .sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || '') || a.name.localeCompare(b.name))[0];
  }

  async reconcileOnChange(): Promise<{ autoSaved: AccountView | null; removed: string | null; switchedTo: string | null }> {
    const nothing = { autoSaved: null, removed: null, switchedTo: null };
    if (!this.store.isAvailable()) return nothing;
    let blob = '';
    try {
      blob = await this.store.readCanonical();
    } catch {
      blob = '';
    }
    const loggedIn = !!this.profile.peekLabel();

    // Logout: no credential AND no active profile.
    if (!blob && !loggedIn) {
      const behavior = this.config.logoutBehavior;
      if (behavior === 'none') return nothing;
      const wasActive = this.meta.read().lastActive;
      let removed: string | null = null;
      if (behavior === 'delete-switch' && wasActive && this.meta.read().accounts.some((a) => a.name === wasActive)) {
        try {
          await this.removeAccount(wasActive);
          removed = wasActive;
        } catch {
          return nothing;
        }
      }
      let switchedTo: string | null = null;
      if (behavior === 'delete-switch' || behavior === 'keep-switch') {
        const next = this.pickNext(wasActive); // exclude the one we just logged out of
        if (next) {
          try {
            await this.switchTo(next.name);
            switchedTo = next.name;
          } catch {
            /* stay signed out */
          }
        }
      }
      await this.meta.update((d) => {
        d.lastActive = switchedTo ?? undefined;
      });
      return { autoSaved: null, removed, switchedTo };
    }

    if (blob) {
      const fpNow = fingerprint(blob);
      const accounts = this.meta.read().accounts;
      const known =
        this.matchByIdentity(accounts, this.profile.currentIdentity()) ?? accounts.find((a) => a.fingerprint === fpNow);
      if (known) {
        await this.meta.update((d) => {
          d.lastActive = known.name;
        });
        if (known.fingerprint !== fpNow) await this.refreshStoredCredential(known.name, blob, fpNow);
        return nothing;
      }
      const saved = await this.autoSaveIfNewLogin();
      if (saved) {
        await this.meta.update((d) => {
          d.lastActive = saved.name;
        });
      }
      return { autoSaved: saved, removed: null, switchedTo: null };
    }
    return nothing;
  }
}
