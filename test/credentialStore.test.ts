import { describe, it, expect } from 'vitest';
import { createCredentialStore } from '../src/credentialStore.js';
import { MacKeychainStore } from '../src/stores/macKeychainStore.js';
import { FileStore } from '../src/stores/fileStore.js';

describe('createCredentialStore', () => {
  it('returns a Keychain store on darwin', () => {
    const s = createCredentialStore({ platform: 'darwin', home: '/Users/k', osUsername: 'k' });
    expect(s).toBeInstanceOf(MacKeychainStore);
    expect(s.isAvailable()).toBe(true);
  });
  it('returns a file store on linux', () => {
    const s = createCredentialStore({ platform: 'linux', home: '/home/k', osUsername: 'k' });
    expect(s).toBeInstanceOf(FileStore);
    expect(s.isAvailable()).toBe(true);
  });
});
