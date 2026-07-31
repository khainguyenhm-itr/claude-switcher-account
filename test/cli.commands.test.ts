import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProgram } from '../src/cli.js';
import { AccountManager } from '../src/accountManager.js';
import { MetadataStore } from '../src/metadataStore.js';
import { ProfileFile } from '../src/profileFile.js';
import type { CredentialStore } from '../src/types.js';

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

function makeManager(canonical: string, profileJson?: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'clp-cli-'));
  const profilePath = join(dir, '.claude.json');
  if (profileJson !== undefined) writeFileSync(profilePath, JSON.stringify(profileJson));
  const store = memStore(canonical);
  const meta = new MetadataStore({ path: join(dir, 'accounts.json') });
  const profile = new ProfileFile({ path: profilePath });
  const mgr = new AccountManager({
    store,
    meta,
    profile,
    config: { logoutBehavior: 'delete-switch' },
    now: () => 'T0',
  });
  return { store, meta, mgr };
}

async function run(mgr: AccountManager, argv: string[], confirm = async () => true) {
  const lines: string[] = [];
  const program = buildProgram({
    manager: mgr,
    now: () => Date.parse('2026-07-31T12:00:00Z'),
    out: (s) => lines.push(s),
    confirm,
  });
  await program.parseAsync(['node', 'claude-p', ...argv]);
  return lines.join('\n');
}

describe('cli commands', () => {
  it('list auto-captures the current login via reconcile-first, then prints it active', async () => {
    const { mgr } = makeManager('BLOB', { oauthAccount: { emailAddress: 'a@x.com', organizationName: 'ITR' } });
    const out = await run(mgr, ['list']);
    expect(out).toContain('a@x.com');
    expect(out).toContain('(active)');
  });

  it('switch changes the active login', async () => {
    const { store, meta, mgr } = makeManager('CUR', { oauthAccount: { emailAddress: 'cur@x.com' } });
    await meta.update((d) =>
      d.accounts.push({
        name: 'b@x.com',
        email: 'b@x.com',
        fingerprint: 'f',
        savedAt: 'T',
        oauthAccount: { emailAddress: 'b@x.com' },
      }),
    );
    store.saved['b@x.com'] = 'BLOB_B';
    const out = await run(mgr, ['switch', 'b@x.com']);
    expect(store.canonical).toBe('BLOB_B');
    expect(out).toContain('Switched to b@x.com');
  });

  it('remove asks for confirmation and deletes on yes', async () => {
    const { store, meta, mgr } = makeManager('', {});
    await meta.update((d) => d.accounts.push({ name: 'a@x.com', email: 'a@x.com', fingerprint: 'f', savedAt: 'T' }));
    store.saved['a@x.com'] = 'X';
    const out = await run(mgr, ['remove', 'a@x.com']);
    expect(meta.read().accounts).toHaveLength(0);
    expect(out).toContain('Removed a@x.com');
  });

  it('remove -y skips the prompt', async () => {
    const { store, meta, mgr } = makeManager('', {});
    await meta.update((d) => d.accounts.push({ name: 'a@x.com', email: 'a@x.com', fingerprint: 'f', savedAt: 'T' }));
    store.saved['a@x.com'] = 'X';
    let asked = false;
    await run(mgr, ['remove', 'a@x.com', '-y'], async () => {
      asked = true;
      return true;
    });
    expect(asked).toBe(false);
    expect(meta.read().accounts).toHaveLength(0);
  });

  it('rename relabels', async () => {
    const { store, meta, mgr } = makeManager('', {});
    await meta.update((d) => d.accounts.push({ name: 'a@x.com', email: 'a@x.com', fingerprint: 'f', savedAt: 'T' }));
    store.saved['a@x.com'] = 'X';
    const out = await run(mgr, ['rename', 'a@x.com', 'work']);
    expect(meta.read().accounts[0].name).toBe('work');
    expect(out).toContain('work');
  });

  it('current shows the active login after reconcile', async () => {
    const { mgr } = makeManager('BLOB', { oauthAccount: { emailAddress: 'a@x.com', organizationName: 'ITR' } });
    const out = await run(mgr, ['current']);
    expect(out).toContain('a@x.com');
  });

  it('switch reports an error for an unknown account', async () => {
    const { mgr } = makeManager('', {});
    const out = await run(mgr, ['switch', 'nope@x.com']);
    expect(out).toMatch(/not found/i);
  });

  it('rename reports an error for a duplicate target', async () => {
    const { store, meta, mgr } = makeManager('', {});
    await meta.update((d) => {
      d.accounts.push({ name: 'a@x.com', email: 'a@x.com', fingerprint: 'f', savedAt: 'T' });
      d.accounts.push({ name: 'b@x.com', email: 'b@x.com', fingerprint: 'g', savedAt: 'T' });
    });
    store.saved['a@x.com'] = 'X';
    const out = await run(mgr, ['rename', 'a@x.com', 'b@x.com']);
    expect(out).toMatch(/already exists/i);
  });

  it('remove cancels when the user declines', async () => {
    const { store, meta, mgr } = makeManager('', {});
    await meta.update((d) => d.accounts.push({ name: 'a@x.com', email: 'a@x.com', fingerprint: 'f', savedAt: 'T' }));
    store.saved['a@x.com'] = 'X';
    const out = await run(mgr, ['remove', 'a@x.com'], async () => false);
    expect(out).toContain('Cancelled');
    expect(meta.read().accounts).toHaveLength(1);
  });

  it('list --json prints machine-readable output', async () => {
    const { meta, mgr } = makeManager('', {});
    await meta.update((d) =>
      d.accounts.push({ name: 'a@x.com', email: 'a@x.com', fingerprint: 'f', savedAt: '2026-07-30T00:00:00Z' }),
    );
    const out = await run(mgr, ['list', '--json']);
    expect(JSON.parse(out)[0]).toMatchObject({ name: 'a@x.com', active: false });
  });
});
