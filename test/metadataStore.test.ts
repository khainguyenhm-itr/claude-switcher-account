import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MetadataStore } from '../src/metadataStore.js';

function newStore() {
  const dir = mkdtempSync(join(tmpdir(), 'clp-meta-'));
  return new MetadataStore({ path: join(dir, 'accounts.json') });
}

describe('MetadataStore', () => {
  let store: MetadataStore;
  beforeEach(() => {
    store = newStore();
  });

  it('reads empty defaults when the file is absent', () => {
    expect(store.read()).toEqual({ accounts: [] });
  });

  it('update writes atomically and returns the new data', async () => {
    const out = await store.update((d) => {
      d.lastActive = 'a@x.com';
      d.accounts.push({ name: 'a@x.com', email: 'a@x.com', fingerprint: 'fp', savedAt: 'T' });
    });
    expect(out.lastActive).toBe('a@x.com');
    expect(store.read().accounts).toHaveLength(1);
  });

  it('serializes concurrent updates without losing writes', async () => {
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        store.update((d) => {
          d.accounts.push({ name: `a${i}`, email: `a${i}`, fingerprint: 'f', savedAt: 'T' });
        }),
      ),
    );
    expect(store.read().accounts).toHaveLength(5); // no lost updates
  });

  it('recovers from a malformed file', () => {
    const s = newStore();
    const path = (s as unknown as { path: string }).path;
    // simulate corruption
    writeFileSync(path, '{ broken');
    expect(s.read()).toEqual({ accounts: [] });
  });

  it('round-trips lastActive through the file', async () => {
    await store.update((d) => {
      d.lastActive = 'x';
    });
    expect(readFileSync((store as unknown as { path: string }).path, 'utf8')).toContain('"lastActive": "x"');
  });
});
