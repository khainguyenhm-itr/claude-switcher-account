import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../src/stores/fileStore.js';

function newStore() {
  const dir = mkdtempSync(join(tmpdir(), 'clp-'));
  return new FileStore({
    canonicalPath: join(dir, '.claude', '.credentials.json'),
    credsPath: join(dir, '.claude-profiles', 'creds.json'),
    platform: 'linux',
  });
}

describe('FileStore', () => {
  let store: FileStore;
  beforeEach(() => {
    store = newStore();
  });

  it('is available on linux, not on darwin', () => {
    expect(store.isAvailable()).toBe(true);
    expect(new FileStore({ canonicalPath: '/x', credsPath: '/y', platform: 'darwin' }).isAvailable()).toBe(false);
  });

  it('reads empty when nothing is stored', async () => {
    expect(await store.readCanonical()).toBe('');
    expect(await store.readSaved('a@x.com')).toBe('');
  });

  it('round-trips the canonical credential', async () => {
    await store.writeCanonical('CANON');
    expect(await store.readCanonical()).toBe('CANON');
  });

  it('round-trips saved credentials by name and deletes them', async () => {
    await store.writeSaved('a@x.com', 'BLOB_A');
    await store.writeSaved('b@x.com', 'BLOB_B');
    expect(await store.readSaved('a@x.com')).toBe('BLOB_A');
    await store.deleteSaved('a@x.com');
    expect(await store.readSaved('a@x.com')).toBe('');
    expect(await store.readSaved('b@x.com')).toBe('BLOB_B'); // deleting one keeps the rest
  });

  it.skipIf(process.platform === 'win32')('writes the creds map file with 0600 permissions', async () => {
    await store.writeSaved('a@x.com', 'BLOB');
    const mode = statSync((store as unknown as { credsPath: string }).credsPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('deleting a missing name does not throw', async () => {
    await expect(store.deleteSaved('nope')).resolves.toBeUndefined();
  });
});
