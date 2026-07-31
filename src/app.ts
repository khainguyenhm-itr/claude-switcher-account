import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { createCredentialStore } from './credentialStore.js';
import { MetadataStore } from './metadataStore.js';
import { ProfileFile } from './profileFile.js';
import { ConfigStore } from './config.js';
import { AccountManager } from './accountManager.js';

export function createManager(env?: { platform?: NodeJS.Platform; home?: string; osUsername?: string }): AccountManager {
  const platform = env?.platform ?? process.platform;
  const home = env?.home ?? homedir();
  const osUsername = env?.osUsername ?? userInfo().username;
  const store = createCredentialStore({ platform, home, osUsername });
  const meta = new MetadataStore({ path: join(home, '.claude-profiles', 'accounts.json') });
  const profile = new ProfileFile({ path: join(home, '.claude.json') });
  const config = new ConfigStore({ path: join(home, '.claude-profiles', 'config.json') }).load();
  return new AccountManager({ store, meta, profile, config });
}
