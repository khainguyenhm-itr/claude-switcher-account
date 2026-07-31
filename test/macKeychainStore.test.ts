import { describe, it, expect } from 'vitest';
import { MacKeychainStore, CLAUDE_SERVICE, STORE_SERVICE } from '../src/stores/macKeychainStore.js';

function mockExec(responses: Record<string, string | Error>) {
  const calls: string[][] = [];
  const exec = async (args: string[]) => {
    calls.push(args);
    const key = args.join(' ');
    const hit = Object.entries(responses).find(([k]) => key.includes(k));
    if (!hit) return '';
    if (hit[1] instanceof Error) throw hit[1];
    return hit[1];
  };
  return { exec, calls };
}

describe('MacKeychainStore', () => {
  it('is available only on darwin', () => {
    const { exec } = mockExec({});
    expect(new MacKeychainStore({ exec, osUsername: 'u', platform: 'darwin' }).isAvailable()).toBe(true);
    expect(new MacKeychainStore({ exec, osUsername: 'u', platform: 'linux' }).isAvailable()).toBe(false);
  });

  it('readCanonical reads the Claude slot for the OS user and trims', async () => {
    const { exec, calls } = mockExec({ [CLAUDE_SERVICE]: 'BLOB\n' });
    const store = new MacKeychainStore({ exec, osUsername: 'khai', platform: 'darwin' });
    expect(await store.readCanonical()).toBe('BLOB');
    expect(calls[0]).toEqual(['find-generic-password', '-w', '-s', CLAUDE_SERVICE, '-a', 'khai']);
  });

  it('readCanonical returns empty when the slot is missing', async () => {
    const { exec } = mockExec({ [CLAUDE_SERVICE]: new Error('not found') });
    const store = new MacKeychainStore({ exec, osUsername: 'khai', platform: 'darwin' });
    expect(await store.readCanonical()).toBe('');
  });

  it('writeCanonical upserts the Claude slot', async () => {
    const { exec, calls } = mockExec({});
    const store = new MacKeychainStore({ exec, osUsername: 'khai', platform: 'darwin' });
    await store.writeCanonical('NEW');
    expect(calls[0]).toEqual(['add-generic-password', '-U', '-s', CLAUDE_SERVICE, '-a', 'khai', '-w', 'NEW']);
  });

  it('saved credentials use our own service keyed by name', async () => {
    const { exec, calls } = mockExec({ [`${STORE_SERVICE} -a bob`]: 'SAVED' });
    const store = new MacKeychainStore({ exec, osUsername: 'khai', platform: 'darwin' });
    await store.writeSaved('bob', 'SAVED');
    expect(calls[0]).toEqual(['add-generic-password', '-U', '-s', STORE_SERVICE, '-a', 'bob', '-w', 'SAVED']);
    expect(await store.readSaved('bob')).toBe('SAVED');
  });

  it('deleteSaved ignores a missing item', async () => {
    const { exec } = mockExec({ 'delete-generic-password': new Error('gone') });
    const store = new MacKeychainStore({ exec, osUsername: 'khai', platform: 'darwin' });
    await expect(store.deleteSaved('bob')).resolves.toBeUndefined();
  });
});
