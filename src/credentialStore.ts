import { join } from 'node:path';
import type { CredentialStore } from './types.js';
import { MacKeychainStore } from './stores/macKeychainStore.js';
import { FileStore } from './stores/fileStore.js';

export interface CreateStoreOpts {
  platform: NodeJS.Platform;
  home: string;
  osUsername: string;
}

export function createCredentialStore(opts: CreateStoreOpts): CredentialStore {
  if (opts.platform === 'darwin') {
    return new MacKeychainStore({ osUsername: opts.osUsername, platform: opts.platform });
  }
  return new FileStore({
    canonicalPath: join(opts.home, '.claude', '.credentials.json'),
    credsPath: join(opts.home, '.claude-profiles', 'creds.json'),
    platform: opts.platform,
  });
}
