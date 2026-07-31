# claude-profiles (`claude-p`) CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cross-platform terminal tool (`claude-p`) that saves multiple Claude Code logins and switches between them by swapping the one canonical credential slot, capturing new logins lazily on every command.

**Architecture:** Four isolated layers — a `CredentialStore` (macOS Keychain via `security`, or a file map on Linux/Windows), a `MetadataStore` (atomic JSON with a `lastActive` marker and a filesystem lock), a `ProfileFile` (reads/writes `~/.claude.json`'s `oauthAccount`), and an `AccountManager` that composes them. A thin commander CLI runs `reconcileOnChange()` before every command so a new login is auto-saved on next use — no background daemon.

**Tech Stack:** Node ≥18, TypeScript (ESM), commander (CLI), vitest (tests + v8 coverage), tsup (bundle to `dist/`). No native modules — macOS uses the `security` binary, Linux/Windows use plain files.

## Global Constraints

- **Platforms:** macOS + Linux + Windows. Each `CredentialStore` gates on `process.platform`.
- **Node:** ≥18. ESM (`"type": "module"`).
- **Package name:** `claude-profiles`. **Binary:** `claude-p` (`bin: { "claude-p": "dist/bin.js" }`).
- **No native modules / no `keytar`.** macOS → `security` CLI; Linux/Windows → files.
- **Keychain service (saved accounts):** `claude-profiles-accounts`. **Canonical Claude slot:** service `Claude Code-credentials`, account = OS username.
- **Config/data dir:** `~/.claude-profiles/` → `config.json`, `accounts.json`, and `creds.json` (file backend, mode `0600`).
- **Canonical file credential (Linux/Windows, ASSUMED — verify in Task 0):** `~/.claude/.credentials.json`.
- **Default `logoutBehavior`:** `delete-switch`. Others: `keep-switch`, `keep`, `none`.
- **Never throw from `reconcileOnChange`** — a reconcile failure must never block the user's command.
- **All store writes are atomic** (temp file + `rename`); the metadata store additionally takes a lock.
- **Coverage target:** ≥90% on `accountManager` and the stores.

---

## Task 0: Verify per-OS Claude credential location (manual, no code)

**This is a research task with no test.** The Linux/Windows credential paths in this plan are assumptions; confirm them before Task 3/4 depend on them.

- [ ] **Step 1: macOS** — confirm the Keychain item exists:
  `security find-generic-password -s "Claude Code-credentials" -a "$(whoami)" -w | head -c 20`
  Expected: prints the start of a token blob (an ACL "allow" dialog is normal).
- [ ] **Step 2: Linux** — on a Linux box with Claude Code logged in, check:
  `ls -l ~/.claude/.credentials.json && head -c 40 ~/.claude/.credentials.json`
  Record the real path and whether it is JSON or raw. If it is not there, search: `grep -rl oauth ~/.claude 2>/dev/null`.
- [ ] **Step 3: Windows** — in PowerShell: `Get-Content $env:USERPROFILE\.claude\.credentials.json -TotalCount 1`. If absent, note whether creds live in Windows Credential Manager (then a future `WinCredStore` is needed; `FileStore` still ships for Linux).
- [ ] **Step 4:** If any real path differs from the assumption, update `CANONICAL_FILE` in Task 3 and the Global Constraints. Record findings in a comment at the top of `src/stores/fileStore.ts`.

---

## Task 1: Project scaffold + `claude-p --version`/help

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/bin.ts`, `src/cli.ts`
- Test: `test/cli.smoke.test.ts`

**Interfaces:**
- Produces: `buildProgram(): import('commander').Command` from `src/cli.ts` — a commander program with `.name('claude-p')`, `.version(...)`, configured with `.exitOverride()` so tests can catch exits.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "claude-profiles",
  "version": "1.0.0",
  "description": "Switch between Claude Code logins from the terminal",
  "type": "module",
  "bin": { "claude-p": "dist/bin.js" },
  "files": ["dist"],
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsup src/bin.ts --format esm --target node18 --clean",
    "test": "vitest run --coverage",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "commander": "^15.0.0" },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@vitest/coverage-v8": "^4.1.10",
    "tsup": "^8.5.1",
    "typescript": "^5.6.0",
    "vitest": "^4.1.10"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": true,
    "declaration": false,
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `vitest.config.ts` and `.gitignore`**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/bin.ts'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
```

`.gitignore`:
```
node_modules/
dist/
coverage/
```

- [ ] **Step 4: Write the failing smoke test** — `test/cli.smoke.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { buildProgram } from '../src/cli.js';

describe('cli', () => {
  it('exposes name and version', () => {
    const program = buildProgram();
    expect(program.name()).toBe('claude-p');
    expect(program.version()).toBe('1.0.0');
  });
});
```

- [ ] **Step 5: Install deps and run the test to verify it fails**

Run: `npm install && npx vitest run test/cli.smoke.test.ts`
Expected: FAIL — cannot resolve `../src/cli.js`.

- [ ] **Step 6: Implement `src/cli.ts` and `src/bin.ts`**

`src/cli.ts`:
```ts
import { Command } from 'commander';

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('claude-p')
    .description('Switch between Claude Code logins')
    .version('1.0.0')
    .exitOverride(); // let callers/tests handle exit instead of process.exit
  return program;
}
```

`src/bin.ts`:
```ts
#!/usr/bin/env node
import { buildProgram } from './cli.js';

const program = buildProgram();
try {
  await program.parseAsync(process.argv);
} catch (err) {
  // commander throws on --help/--version/bad input under exitOverride
  const code = (err as { exitCode?: number }).exitCode ?? 1;
  process.exit(code);
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run test/cli.smoke.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src test
git commit -m "chore: scaffold claude-profiles CLI (commander + vitest)"
```

---

## Task 2: Core types + fingerprint util

**Files:**
- Create: `src/types.ts`, `src/fingerprint.ts`
- Test: `test/fingerprint.test.ts`

**Interfaces:**
- Produces (`src/types.ts`):
```ts
export interface AccountMeta {
  name: string; email: string;
  displayName?: string; organizationName?: string;
  fingerprint: string; savedAt: string;
  oauthAccount?: Record<string, unknown>;
}
export interface AccountView {
  name: string; email: string;
  displayName?: string; organizationName?: string;
  savedAt: string; active: boolean;
}
export interface OauthLabel { email: string; displayName?: string; organizationName?: string; }
export interface StoreData { lastActive?: string; accounts: AccountMeta[]; }
export type LogoutBehavior = 'delete-switch' | 'keep-switch' | 'keep' | 'none';
export interface Config { logoutBehavior: LogoutBehavior; }
export interface CredentialStore {
  isAvailable(): boolean;
  readCanonical(): Promise<string>;              // '' when no login
  writeCanonical(blob: string): Promise<void>;
  readSaved(name: string): Promise<string>;      // '' when not found
  writeSaved(name: string, blob: string): Promise<void>;
  deleteSaved(name: string): Promise<void>;
}
```
- Produces (`src/fingerprint.ts`): `fingerprint(blob: string): string` — sha256 hex.

- [ ] **Step 1: Write the failing test** — `test/fingerprint.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { fingerprint } from '../src/fingerprint.js';

describe('fingerprint', () => {
  it('is a stable 64-char sha256 hex of the blob', () => {
    const fp = fingerprint('hello');
    expect(fp).toHaveLength(64);
    expect(fp).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(fingerprint('hello')).toBe(fp);
    expect(fingerprint('world')).not.toBe(fp);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/fingerprint.test.ts`
Expected: FAIL — cannot resolve `../src/fingerprint.js`.

- [ ] **Step 3: Implement `src/types.ts` (from the Interfaces block above) and `src/fingerprint.ts`**

`src/fingerprint.ts`:
```ts
import { createHash } from 'node:crypto';

export function fingerprint(blob: string): string {
  return createHash('sha256').update(blob).digest('hex');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/fingerprint.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/fingerprint.ts test/fingerprint.test.ts
git commit -m "feat: core types and fingerprint util"
```

---

## Task 3: FileStore (Linux/Windows credential backend)

**Files:**
- Create: `src/stores/fileStore.ts`
- Test: `test/fileStore.test.ts`

**Interfaces:**
- Consumes: `CredentialStore` from `src/types.ts`.
- Produces: `class FileStore implements CredentialStore` with constructor `new FileStore(opts: { canonicalPath: string; credsPath: string; platform?: NodeJS.Platform })`. Saved credentials live in a single JSON map file at `credsPath` (`{ "<name>": "<blob>" }`, written mode `0600`). `readCanonical`/`writeCanonical` read/write the raw `canonicalPath` file.

- [ ] **Step 1: Write the failing test** — `test/fileStore.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
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
  beforeEach(() => { store = newStore(); });

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

  it('writes the creds map file with 0600 permissions', async () => {
    await store.writeSaved('a@x.com', 'BLOB');
    const mode = statSync((store as unknown as { credsPath: string }).credsPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('deleting a missing name does not throw', async () => {
    await expect(store.deleteSaved('nope')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/fileStore.test.ts`
Expected: FAIL — cannot resolve `../src/stores/fileStore.js`.

- [ ] **Step 3: Implement `src/stores/fileStore.ts`**

```ts
// NOTE: canonicalPath is the location Claude Code stores its login on Linux/Windows.
// Verified in Task 0 as ~/.claude/.credentials.json — update here if that differs.
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CredentialStore } from '../types.js';

export interface FileStoreOpts {
  canonicalPath: string;
  credsPath: string;
  platform?: NodeJS.Platform;
}

export class FileStore implements CredentialStore {
  private readonly canonicalPath: string;
  private readonly credsPath: string;
  private readonly platform: NodeJS.Platform;

  constructor(opts: FileStoreOpts) {
    this.canonicalPath = opts.canonicalPath;
    this.credsPath = opts.credsPath;
    this.platform = opts.platform ?? process.platform;
  }

  isAvailable(): boolean {
    return this.platform === 'linux' || this.platform === 'win32';
  }

  private atomicWrite(path: string, data: string, mode?: number): void {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, data, mode !== undefined ? { mode } : undefined);
    renameSync(tmp, path);
  }

  private readMap(): Record<string, string> {
    if (!existsSync(this.credsPath)) return {};
    try {
      const parsed = JSON.parse(readFileSync(this.credsPath, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  async readCanonical(): Promise<string> {
    try { return readFileSync(this.canonicalPath, 'utf8').trim(); }
    catch { return ''; }
  }

  async writeCanonical(blob: string): Promise<void> {
    this.atomicWrite(this.canonicalPath, blob, 0o600);
  }

  async readSaved(name: string): Promise<string> {
    return this.readMap()[name] ?? '';
  }

  async writeSaved(name: string, blob: string): Promise<void> {
    const map = this.readMap();
    map[name] = blob;
    this.atomicWrite(this.credsPath, JSON.stringify(map, null, 2), 0o600);
  }

  async deleteSaved(name: string): Promise<void> {
    const map = this.readMap();
    if (!(name in map)) return;
    delete map[name];
    this.atomicWrite(this.credsPath, JSON.stringify(map, null, 2), 0o600);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/fileStore.test.ts`
Expected: PASS. (On Windows the `0o600` mode assertion is a no-op-ish; this suite targets the Linux path — mark the mode test `it.skipIf(process.platform === 'win32')` if you develop on Windows.)

- [ ] **Step 5: Commit**

```bash
git add src/stores/fileStore.ts test/fileStore.test.ts
git commit -m "feat: FileStore credential backend for Linux/Windows"
```

---

## Task 4: MacKeychainStore (macOS credential backend)

**Files:**
- Create: `src/stores/macKeychainStore.ts`
- Test: `test/macKeychainStore.test.ts`

**Interfaces:**
- Consumes: `CredentialStore` from `src/types.ts`.
- Produces: `type SecurityExec = (args: string[]) => Promise<string>` and `class MacKeychainStore implements CredentialStore` with constructor `new MacKeychainStore(opts: { exec?: SecurityExec; osUsername: string; platform?: NodeJS.Platform })`. Constants `CLAUDE_SERVICE = 'Claude Code-credentials'`, `STORE_SERVICE = 'claude-profiles-accounts'` are exported.

- [ ] **Step 1: Write the failing test** — `test/macKeychainStore.test.ts`

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/macKeychainStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/stores/macKeychainStore.ts`**

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CredentialStore } from '../types.js';

const execFileP = promisify(execFile);

export const CLAUDE_SERVICE = 'Claude Code-credentials';
export const STORE_SERVICE = 'claude-profiles-accounts';

export type SecurityExec = (args: string[]) => Promise<string>;

const defaultExec: SecurityExec = async (args) => {
  const { stdout } = await execFileP('security', args);
  return stdout;
};

export interface MacKeychainStoreOpts {
  exec?: SecurityExec;
  osUsername: string;
  platform?: NodeJS.Platform;
}

export class MacKeychainStore implements CredentialStore {
  private readonly exec: SecurityExec;
  private readonly osUsername: string;
  private readonly platform: NodeJS.Platform;

  constructor(opts: MacKeychainStoreOpts) {
    this.exec = opts.exec ?? defaultExec;
    this.osUsername = opts.osUsername;
    this.platform = opts.platform ?? process.platform;
  }

  isAvailable(): boolean {
    return this.platform === 'darwin';
  }

  async readCanonical(): Promise<string> {
    try {
      const out = await this.exec(['find-generic-password', '-w', '-s', CLAUDE_SERVICE, '-a', this.osUsername]);
      return out.trim();
    } catch { return ''; }
  }

  async writeCanonical(blob: string): Promise<void> {
    await this.exec(['add-generic-password', '-U', '-s', CLAUDE_SERVICE, '-a', this.osUsername, '-w', blob]);
  }

  async readSaved(name: string): Promise<string> {
    try {
      const out = await this.exec(['find-generic-password', '-w', '-s', STORE_SERVICE, '-a', name]);
      return out.trim();
    } catch { return ''; }
  }

  async writeSaved(name: string, blob: string): Promise<void> {
    await this.exec(['add-generic-password', '-U', '-s', STORE_SERVICE, '-a', name, '-w', blob]);
  }

  async deleteSaved(name: string): Promise<void> {
    try { await this.exec(['delete-generic-password', '-s', STORE_SERVICE, '-a', name]); }
    catch { /* already gone */ }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/macKeychainStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/macKeychainStore.ts test/macKeychainStore.test.ts
git commit -m "feat: MacKeychainStore credential backend for macOS"
```

---

## Task 5: CredentialStore factory (platform selection)

**Files:**
- Create: `src/credentialStore.ts`
- Test: `test/credentialStore.test.ts`

**Interfaces:**
- Consumes: `MacKeychainStore`, `FileStore`, `CredentialStore`.
- Produces: `createCredentialStore(opts: { platform: NodeJS.Platform; home: string; osUsername: string }): CredentialStore`. Chooses `MacKeychainStore` on `darwin`, else `FileStore` with `canonicalPath = <home>/.claude/.credentials.json` and `credsPath = <home>/.claude-profiles/creds.json`.

- [ ] **Step 1: Write the failing test** — `test/credentialStore.test.ts`

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/credentialStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/credentialStore.ts`**

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/credentialStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/credentialStore.ts test/credentialStore.test.ts
git commit -m "feat: credential store factory by platform"
```

---

## Task 6: MetadataStore (atomic JSON + lock + lastActive)

**Files:**
- Create: `src/metadataStore.ts`
- Test: `test/metadataStore.test.ts`

**Interfaces:**
- Consumes: `StoreData`, `AccountMeta` from `src/types.ts`.
- Produces: `class MetadataStore` with constructor `new MetadataStore(opts: { path: string })` and methods:
  - `read(): StoreData` — `{ accounts: [] }` when missing/malformed.
  - `update(mutator: (data: StoreData) => void): Promise<StoreData>` — takes a lock, reads, applies `mutator`, writes atomically, returns the new data.
  The lock is a `mkdir`-based mutex at `<path>.lock` with retry + stale-steal after 10s.

- [ ] **Step 1: Write the failing test** — `test/metadataStore.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MetadataStore } from '../src/metadataStore.js';

function newStore() {
  const dir = mkdtempSync(join(tmpdir(), 'clp-meta-'));
  return new MetadataStore({ path: join(dir, 'accounts.json') });
}

describe('MetadataStore', () => {
  let store: MetadataStore;
  beforeEach(() => { store = newStore(); });

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
        store.update((d) => { d.accounts.push({ name: `a${i}`, email: `a${i}`, fingerprint: 'f', savedAt: 'T' }); })),
    );
    expect(store.read().accounts).toHaveLength(5); // no lost updates
  });

  it('recovers from a malformed file', () => {
    const s = newStore();
    const path = (s as unknown as { path: string }).path;
    // simulate corruption
    require('node:fs').writeFileSync(path, '{ broken');
    expect(s.read()).toEqual({ accounts: [] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/metadataStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/metadataStore.ts`**

```ts
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, mkdir, rmdir, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { StoreData } from './types.js';

const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface MetadataStoreOpts { path: string; }

export class MetadataStore {
  private readonly path: string;
  private readonly lockPath: string;

  constructor(opts: MetadataStoreOpts) {
    this.path = opts.path;
    this.lockPath = `${opts.path}.lock`;
  }

  read(): StoreData {
    if (!existsSync(this.path)) return { accounts: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'));
      return { lastActive: parsed?.lastActive, accounts: Array.isArray(parsed?.accounts) ? parsed.accounts : [] };
    } catch {
      return { accounts: [] };
    }
  }

  private async acquireLock(): Promise<void> {
    mkdirSync(dirname(this.lockPath), { recursive: true });
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    for (;;) {
      try {
        mkdirSync(this.lockPath); // atomic: fails with EEXIST if held
        return;
      } catch {
        // steal a stale lock left by a crashed process
        try {
          if (Date.now() - statSync(this.lockPath).mtimeMs > LOCK_STALE_MS) {
            rmdirSafe(this.lockPath);
            continue;
          }
        } catch { /* lock vanished between calls — retry */ }
        if (Date.now() > deadline) throw new Error(`Timed out acquiring lock ${this.lockPath}`);
        await sleep(LOCK_RETRY_MS);
      }
    }
  }

  private releaseLock(): void { rmdirSafe(this.lockPath); }

  async update(mutator: (data: StoreData) => void): Promise<StoreData> {
    await this.acquireLock();
    try {
      const data = this.read();
      mutator(data);
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp-${process.pid}`;
      writeFileSync(tmp, JSON.stringify({ lastActive: data.lastActive, accounts: data.accounts }, null, 2));
      renameSync(tmp, this.path);
      return data;
    } finally {
      this.releaseLock();
    }
  }
}

function rmdirSafe(p: string): void {
  try { rmdir(p, () => undefined); } catch { /* best-effort */ }
}
```

> Implementation note: `rmdir` is used async-fire-and-forget for release; if a test flakes on lock cleanup, switch `rmdirSafe` to `rmSync(p, { recursive: true, force: true })`. Keep the `import` list in sync with what you actually use (drop `mkdir` if unused).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/metadataStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/metadataStore.ts test/metadataStore.test.ts
git commit -m "feat: MetadataStore with atomic writes, lock, and lastActive"
```

---

## Task 7: ProfileFile (`~/.claude.json` labels + oauthAccount)

**Files:**
- Create: `src/profileFile.ts`
- Test: `test/profileFile.test.ts`

**Interfaces:**
- Consumes: `OauthLabel` from `src/types.ts`.
- Produces: `class ProfileFile` with constructor `new ProfileFile(opts: { path: string })` and methods:
  - `peekLabel(): OauthLabel | null`
  - `peekOauthAccount(): Record<string, unknown> | undefined`
  - `currentIdentity(): { uuid?: string; email?: string }`
  - `applyOauthAccount(snapshot: Record<string, unknown> | undefined): void` — set or delete `oauthAccount`, preserving other keys, atomic write, never corrupts.

- [ ] **Step 1: Write the failing test** — `test/profileFile.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfileFile } from '../src/profileFile.js';

function newFile(contents?: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'clp-prof-'));
  const path = join(dir, '.claude.json');
  if (contents !== undefined) writeFileSync(path, JSON.stringify(contents));
  return { path, profile: new ProfileFile({ path }) };
}

describe('ProfileFile', () => {
  it('peekLabel returns email/displayName/org from oauthAccount', () => {
    const { profile } = newFile({ oauthAccount: { emailAddress: 'a@x.com', displayName: 'A', organizationName: 'ORG' } });
    expect(profile.peekLabel()).toEqual({ email: 'a@x.com', displayName: 'A', organizationName: 'ORG' });
  });

  it('peekLabel returns null when file missing or no email', () => {
    expect(newFile().profile.peekLabel()).toBeNull();
    expect(newFile({ oauthAccount: {} }).profile.peekLabel()).toBeNull();
    expect(newFile('not json' as unknown).profile.peekLabel()).toBeNull();
  });

  it('currentIdentity reads accountUuid and email', () => {
    const { profile } = newFile({ oauthAccount: { accountUuid: 'U', emailAddress: 'a@x.com' } });
    expect(profile.currentIdentity()).toEqual({ uuid: 'U', email: 'a@x.com' });
  });

  it('applyOauthAccount sets the snapshot but preserves other keys', () => {
    const { path, profile } = newFile({ numStartups: 3, oauthAccount: { emailAddress: 'old@x.com' } });
    profile.applyOauthAccount({ emailAddress: 'new@x.com' });
    const d = JSON.parse(readFileSync(path, 'utf8'));
    expect(d.numStartups).toBe(3);
    expect(d.oauthAccount).toEqual({ emailAddress: 'new@x.com' });
  });

  it('applyOauthAccount(undefined) removes oauthAccount', () => {
    const { path, profile } = newFile({ keep: 1, oauthAccount: { emailAddress: 'x' } });
    profile.applyOauthAccount(undefined);
    const d = JSON.parse(readFileSync(path, 'utf8'));
    expect(d.keep).toBe(1);
    expect(d.oauthAccount).toBeUndefined();
  });

  it('applyOauthAccount(undefined) with no file writes nothing', () => {
    const { path, profile } = newFile();
    profile.applyOauthAccount(undefined);
    expect(existsSync(path)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/profileFile.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/profileFile.ts`**

```ts
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import type { OauthLabel } from './types.js';

export interface ProfileFileOpts { path: string; }

export class ProfileFile {
  private readonly path: string;
  constructor(opts: ProfileFileOpts) { this.path = opts.path; }

  private read(): Record<string, unknown> | null {
    try {
      const d = JSON.parse(readFileSync(this.path, 'utf8'));
      return d && typeof d === 'object' ? d : null;
    } catch { return null; }
  }

  peekOauthAccount(): Record<string, unknown> | undefined {
    const oa = this.read()?.oauthAccount;
    return oa && typeof oa === 'object' ? (oa as Record<string, unknown>) : undefined;
  }

  peekLabel(): OauthLabel | null {
    const oa = this.peekOauthAccount();
    const email = typeof oa?.emailAddress === 'string' ? oa.emailAddress : undefined;
    if (!email) return null;
    return {
      email,
      displayName: typeof oa?.displayName === 'string' ? oa.displayName : undefined,
      organizationName: typeof oa?.organizationName === 'string' ? oa.organizationName : undefined,
    };
  }

  currentIdentity(): { uuid?: string; email?: string } {
    const oa = this.peekOauthAccount();
    return {
      uuid: typeof oa?.accountUuid === 'string' ? oa.accountUuid : undefined,
      email: typeof oa?.emailAddress === 'string' ? oa.emailAddress : undefined,
    };
  }

  applyOauthAccount(snapshot: Record<string, unknown> | undefined): void {
    let d = this.read();
    if (!d) {
      if (!snapshot) return; // no file and nothing to restore
      d = {};
    }
    if (snapshot) d.oauthAccount = snapshot;
    else delete d.oauthAccount;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp-${process.pid}`;
      writeFileSync(tmp, JSON.stringify(d, null, 2));
      renameSync(tmp, this.path);
    } catch { /* best-effort: leave the file as-is */ }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/profileFile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/profileFile.ts test/profileFile.test.ts
git commit -m "feat: ProfileFile for ~/.claude.json labels and oauthAccount"
```

---

## Task 8: AccountManager — save / list / switch / remove / rename

**Files:**
- Create: `src/accountManager.ts`
- Test: `test/accountManager.core.test.ts`

**Interfaces:**
- Consumes: `CredentialStore`, `MetadataStore`, `ProfileFile`, `AccountMeta`, `AccountView`, `fingerprint`.
- Produces: `class AccountManager` with constructor `new AccountManager(deps: { store: CredentialStore; meta: MetadataStore; profile: ProfileFile; now?: () => string })` and public methods used by later tasks:
  - `listAccounts(): Promise<AccountView[]>`
  - `switchTo(name: string): Promise<void>` — throws `Error` if the saved account is missing.
  - `removeAccount(name: string): Promise<void>`
  - `renameAccount(oldName: string, newName: string): Promise<void>` — throws if `oldName` missing or `newName` exists.
  - `saveCurrent(name?: string): Promise<AccountView>` — snapshot the active login (used by reconcile in Task 9); throws on empty blob / stale-email collision.
  - `current(): { saved: AccountView | null; label: OauthLabel | null }`
  - Private helpers `matchByIdentity`, `refreshStoredCredential` are added here and reused in Task 9.

- [ ] **Step 1: Write the failing test** — `test/accountManager.core.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountManager } from '../src/accountManager.js';
import { MetadataStore } from '../src/metadataStore.js';
import { ProfileFile } from '../src/profileFile.js';
import type { CredentialStore } from '../src/types.js';

// In-memory credential store for tests.
function memStore(canonical = ''): CredentialStore & { canonical: string; saved: Record<string, string> } {
  return {
    canonical,
    saved: {} as Record<string, string>,
    isAvailable() { return true; },
    async readCanonical() { return this.canonical; },
    async writeCanonical(b: string) { this.canonical = b; },
    async readSaved(n: string) { return this.saved[n] ?? ''; },
    async writeSaved(n: string, b: string) { this.saved[n] = b; },
    async deleteSaved(n: string) { delete this.saved[n]; },
  };
}

function setup(canonical = '', profileJson?: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'clp-mgr-'));
  const metaPath = join(dir, 'accounts.json');
  const profilePath = join(dir, '.claude.json');
  if (profileJson !== undefined) writeFileSync(profilePath, JSON.stringify(profileJson));
  const store = memStore(canonical);
  const meta = new MetadataStore({ path: metaPath });
  const profile = new ProfileFile({ path: profilePath });
  const mgr = new AccountManager({ store, meta, profile, now: () => 'T0' });
  return { store, meta, profile, mgr };
}

describe('AccountManager core', () => {
  it('saveCurrent stores the blob under the email and upserts metadata', async () => {
    const { store, meta, mgr } = setup('BLOB', { oauthAccount: { emailAddress: 'a@x.com', organizationName: 'ORG' } });
    const view = await mgr.saveCurrent();
    expect(view.name).toBe('a@x.com');
    expect(store.saved['a@x.com']).toBe('BLOB');
    expect(meta.read().accounts[0]).toMatchObject({ name: 'a@x.com', email: 'a@x.com', organizationName: 'ORG' });
  });

  it('saveCurrent refuses when there is no login', async () => {
    const { mgr } = setup('', {});
    await expect(mgr.saveCurrent()).rejects.toThrow(/no current claude login/i);
  });

  it('switchTo writes the saved blob into the canonical slot and restores the label', async () => {
    const { store, meta, profile, mgr } = setup('CUR', { oauthAccount: { emailAddress: 'cur@x.com' } });
    await meta.update((d) => d.accounts.push({
      name: 'b@x.com', email: 'b@x.com', fingerprint: 'fp', savedAt: 'T',
      oauthAccount: { emailAddress: 'b@x.com' },
    }));
    store.saved['b@x.com'] = 'SAVED_B';
    await mgr.switchTo('b@x.com');
    expect(store.canonical).toBe('SAVED_B');
    expect(profile.peekLabel()?.email).toBe('b@x.com');
  });

  it('switchTo throws when the saved account is missing', async () => {
    const { mgr } = setup('', {});
    await expect(mgr.switchTo('nope@x.com')).rejects.toThrow(/not found/i);
  });

  it('listAccounts marks the identity-matching account active even after token rotation', async () => {
    const { meta, mgr } = setup('ROTATED', { oauthAccount: { accountUuid: 'U1', emailAddress: 'a@x.com' } });
    await meta.update((d) => d.accounts.push({
      name: 'a@x.com', email: 'a@x.com', fingerprint: 'OLD_FP', savedAt: 'T',
      oauthAccount: { accountUuid: 'U1', emailAddress: 'a@x.com' },
    }));
    const [row] = await mgr.listAccounts();
    expect(row.active).toBe(true); // matched by uuid, not fingerprint
  });

  it('removeAccount deletes the credential and metadata entry', async () => {
    const { store, meta, mgr } = setup('', {});
    await meta.update((d) => d.accounts.push({ name: 'a@x.com', email: 'a@x.com', fingerprint: 'f', savedAt: 'T' }));
    store.saved['a@x.com'] = 'X';
    await mgr.removeAccount('a@x.com');
    expect(store.saved['a@x.com']).toBeUndefined();
    expect(meta.read().accounts).toHaveLength(0);
  });

  it('renameAccount moves the credential and relabels metadata', async () => {
    const { store, meta, mgr } = setup('', {});
    await meta.update((d) => { d.lastActive = 'a@x.com'; d.accounts.push({ name: 'a@x.com', email: 'a@x.com', fingerprint: 'f', savedAt: 'T' }); });
    store.saved['a@x.com'] = 'BLOB';
    await mgr.renameAccount('a@x.com', 'work');
    expect(store.saved).toEqual({ work: 'BLOB' });
    expect(meta.read().accounts[0].name).toBe('work');
    expect(meta.read().lastActive).toBe('work'); // lastActive follows the rename
  });

  it('renameAccount rejects a duplicate target', async () => {
    const { meta, mgr } = setup('', {});
    await meta.update((d) => {
      d.accounts.push({ name: 'a@x.com', email: 'a@x.com', fingerprint: 'f', savedAt: 'T' });
      d.accounts.push({ name: 'b@x.com', email: 'b@x.com', fingerprint: 'g', savedAt: 'T' });
    });
    await expect(mgr.renameAccount('a@x.com', 'b@x.com')).rejects.toThrow(/already exists/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/accountManager.core.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/accountManager.ts`** (core methods; reconcile added in Task 9)

```ts
import type { CredentialStore, AccountMeta, AccountView, OauthLabel } from './types.js';
import type { MetadataStore } from './metadataStore.js';
import type { ProfileFile } from './profileFile.js';
import { fingerprint } from './fingerprint.js';

export interface AccountManagerDeps {
  store: CredentialStore;
  meta: MetadataStore;
  profile: ProfileFile;
  now?: () => string;
}

function toView(a: AccountMeta, active: boolean): AccountView {
  return { name: a.name, email: a.email, displayName: a.displayName, organizationName: a.organizationName, savedAt: a.savedAt, active };
}

export class AccountManager {
  protected readonly store: CredentialStore;
  protected readonly meta: MetadataStore;
  protected readonly profile: ProfileFile;
  protected readonly now: () => string;

  constructor(deps: AccountManagerDeps) {
    this.store = deps.store;
    this.meta = deps.meta;
    this.profile = deps.profile;
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
    if (!finalName) { matched = data.accounts.find((a) => a.fingerprint === fp); finalName = matched?.name; }
    if (!finalName) {
      const email = label?.email;
      const collision = email ? data.accounts.find((a) => a.name === email && a.fingerprint !== fp) : undefined;
      if (collision) throw new Error(`Current login does not match saved account '${email}'. Its profile may be stale — retry after the session initializes.`);
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
    await this.meta.update((d) => { d.accounts = [...d.accounts.filter((a) => a.name !== finalName), entry]; });
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
    try { await this.store.writeSaved(name, blob); } catch { return; }
    await this.meta.update((d) => {
      const idx = d.accounts.findIndex((a) => a.name === name);
      if (idx < 0) return;
      d.accounts[idx] = { ...d.accounts[idx], fingerprint: fp, oauthAccount: this.profile.peekOauthAccount() ?? d.accounts[idx].oauthAccount, savedAt: this.now() };
    });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/accountManager.core.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/accountManager.ts test/accountManager.core.test.ts
git commit -m "feat: AccountManager save/list/switch/remove/rename"
```

---

## Task 9: AccountManager — reconcileOnChange + Config (logout behavior)

**Files:**
- Create: `src/config.ts`
- Modify: `src/accountManager.ts` (add `reconcileOnChange`, `autoSaveIfNewLogin`, accept `config` dep)
- Test: `test/config.test.ts`, `test/accountManager.reconcile.test.ts`

**Interfaces:**
- Consumes: everything from Task 8, plus `Config`, `LogoutBehavior`.
- Produces (`src/config.ts`): `class ConfigStore { constructor(opts: { path: string }); load(): Config }` — default `{ logoutBehavior: 'delete-switch' }` when missing/malformed/invalid value.
- Produces (extends `AccountManager`): constructor dep gains `config: Config`; new methods:
  - `autoSaveIfNewLogin(): Promise<AccountView | null>` — never throws.
  - `reconcileOnChange(): Promise<{ autoSaved: AccountView | null; removed: string | null; switchedTo: string | null }>` — never throws; persists `lastActive`; applies `config.logoutBehavior` on logout.

- [ ] **Step 1: Write the failing config test** — `test/config.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from '../src/config.js';

function at(contents?: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'clp-cfg-'));
  const path = join(dir, 'config.json');
  if (contents !== undefined) writeFileSync(path, typeof contents === 'string' ? contents : JSON.stringify(contents));
  return new ConfigStore({ path });
}

describe('ConfigStore', () => {
  it('defaults to delete-switch when absent', () => {
    expect(at().load()).toEqual({ logoutBehavior: 'delete-switch' });
  });
  it('reads a valid behavior', () => {
    expect(at({ logoutBehavior: 'keep' }).load().logoutBehavior).toBe('keep');
  });
  it('falls back to default on an invalid value or malformed file', () => {
    expect(at({ logoutBehavior: 'bogus' }).load().logoutBehavior).toBe('delete-switch');
    expect(at('{bad').load().logoutBehavior).toBe('delete-switch');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/config.ts`**

```ts
import { readFileSync } from 'node:fs';
import type { Config, LogoutBehavior } from './types.js';

const VALID: LogoutBehavior[] = ['delete-switch', 'keep-switch', 'keep', 'none'];
const DEFAULT: Config = { logoutBehavior: 'delete-switch' };

export interface ConfigStoreOpts { path: string; }

export class ConfigStore {
  private readonly path: string;
  constructor(opts: ConfigStoreOpts) { this.path = opts.path; }

  load(): Config {
    try {
      const d = JSON.parse(readFileSync(this.path, 'utf8'));
      const b = d?.logoutBehavior;
      return VALID.includes(b) ? { logoutBehavior: b } : DEFAULT;
    } catch {
      return DEFAULT;
    }
  }
}
```

- [ ] **Step 4: Run the config test to verify it passes**

Run: `npx vitest run test/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing reconcile test** — `test/accountManager.reconcile.test.ts`

```ts
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
    isAvailable() { return true; },
    async readCanonical() { return this.canonical; },
    async writeCanonical(b: string) { this.canonical = b; },
    async readSaved(n: string) { return this.saved[n] ?? ''; },
    async writeSaved(n: string, b: string) { this.saved[n] = b; },
    async deleteSaved(n: string) { delete this.saved[n]; },
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
    const { store, meta, mgr } = setup('ROTATED', { oauthAccount: { accountUuid: 'U', emailAddress: 'a@x.com' } }, { logoutBehavior: 'none' });
    await meta.update((d) => d.accounts.push({ name: 'a@x.com', email: 'a@x.com', fingerprint: 'OLD', savedAt: 'T', oauthAccount: { accountUuid: 'U', emailAddress: 'a@x.com' } }));
    await mgr.reconcileOnChange();
    expect(store.saved['a@x.com']).toBe('ROTATED');
    expect(meta.read().accounts[0].fingerprint).toBe(fingerprint('ROTATED'));
  });

  it('delete-switch: logout removes the account and switches to the newest remaining', async () => {
    const { store, meta, profile, profilePath, mgr } = setup('CUR', { oauthAccount: { emailAddress: 'a@x.com' } }, { logoutBehavior: 'delete-switch' });
    await meta.update((d) => {
      d.lastActive = 'a@x.com';
      d.accounts.push({ name: 'a@x.com', email: 'a@x.com', fingerprint: fingerprint('CUR'), savedAt: '2026-01-01', oauthAccount: { emailAddress: 'a@x.com' } });
      d.accounts.push({ name: 'b@x.com', email: 'b@x.com', fingerprint: 'fb', savedAt: '2026-02-01', oauthAccount: { emailAddress: 'b@x.com' } });
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
    const { store, meta, profilePath, mgr } = setup('CUR', { oauthAccount: { emailAddress: 'a@x.com' } }, { logoutBehavior: 'keep' });
    await meta.update((d) => { d.lastActive = 'a@x.com'; d.accounts.push({ name: 'a@x.com', email: 'a@x.com', fingerprint: 'fa', savedAt: 'T' }); });
    (store as { canonical: string }).canonical = '';
    rmSync(profilePath);
    const res = await mgr.reconcileOnChange();
    expect(res.removed).toBeNull();
    expect(res.switchedTo).toBeNull();
    expect(meta.read().accounts).toHaveLength(1); // account kept
  });

  it('does NOT remove on a login-over (switch to a known account)', async () => {
    const { meta, mgr } = setup('BLOB_B', { oauthAccount: { emailAddress: 'b@x.com' } }, { logoutBehavior: 'delete-switch' });
    await meta.update((d) => {
      d.lastActive = 'a@x.com';
      d.accounts.push({ name: 'b@x.com', email: 'b@x.com', fingerprint: fingerprint('BLOB_B'), savedAt: 'T', oauthAccount: { emailAddress: 'b@x.com' } });
    });
    const res = await mgr.reconcileOnChange();
    expect(res.removed).toBeNull();
    expect(meta.read().lastActive).toBe('b@x.com');
  });

  it('never throws when the platform is unsupported', async () => {
    const { store, mgr } = setup('', {}, { logoutBehavior: 'none' });
    (store as unknown as { isAvailable(): boolean }).isAvailable = () => false;
    await expect(mgr.reconcileOnChange()).resolves.toEqual({ autoSaved: null, removed: null, switchedTo: null });
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run test/accountManager.reconcile.test.ts`
Expected: FAIL — `config` is not accepted / `reconcileOnChange` undefined.

- [ ] **Step 7: Extend `src/accountManager.ts`**

Add `config` to deps and the reconcile logic. Change the deps interface and constructor:

```ts
// in AccountManagerDeps, add:
//   config: Config;
// import Config, LogoutBehavior from './types.js'
// store it: this.config = deps.config;  (add `protected readonly config: Config;`)
```

Append these methods to the class:

```ts
  async autoSaveIfNewLogin(): Promise<AccountView | null> {
    if (!this.store.isAvailable()) return null;
    let blob = '';
    try { blob = await this.store.readCanonical(); } catch { return null; }
    if (!blob) return null;
    const fp = fingerprint(blob);
    if (this.meta.read().accounts.some((a) => a.fingerprint === fp)) return null; // already saved / just switched
    if (!this.profile.peekLabel()?.email) return null; // no email yet → capture on the next command
    try { return await this.saveCurrent(); } catch { return null; }
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
    try { blob = await this.store.readCanonical(); } catch { blob = ''; }
    const loggedIn = !!this.profile.peekLabel();

    // Logout: no credential AND no active profile.
    if (!blob && !loggedIn) {
      const behavior = this.config.logoutBehavior;
      if (behavior === 'none') return nothing;
      const wasActive = this.meta.read().lastActive;
      let removed: string | null = null;
      if (behavior === 'delete-switch' && wasActive && this.meta.read().accounts.some((a) => a.name === wasActive)) {
        try { await this.removeAccount(wasActive); removed = wasActive; } catch { return nothing; }
      }
      let switchedTo: string | null = null;
      if (behavior === 'delete-switch' || behavior === 'keep-switch') {
        const next = this.pickNext(wasActive); // exclude the one we just logged out of
        if (next) {
          try { await this.switchTo(next.name); switchedTo = next.name; } catch { /* stay signed out */ }
        }
      }
      await this.meta.update((d) => { d.lastActive = switchedTo ?? undefined; });
      return { autoSaved: null, removed, switchedTo };
    }

    if (blob) {
      const fpNow = fingerprint(blob);
      const accounts = this.meta.read().accounts;
      const known = this.matchByIdentity(accounts, this.profile.currentIdentity()) ?? accounts.find((a) => a.fingerprint === fpNow);
      if (known) {
        await this.meta.update((d) => { d.lastActive = known.name; });
        if (known.fingerprint !== fpNow) await this.refreshStoredCredential(known.name, blob, fpNow);
        return nothing;
      }
      const saved = await this.autoSaveIfNewLogin();
      if (saved) await this.meta.update((d) => { d.lastActive = saved.name; });
      return { autoSaved: saved, removed: null, switchedTo: null };
    }
    return nothing;
  }
```

Update Task 8's tests' constructor calls if needed — the `config` dep is now required. In `test/accountManager.core.test.ts`, add `config: { logoutBehavior: 'delete-switch' }` to the `new AccountManager({ ... })` call.

- [ ] **Step 8: Run both manager tests to verify they pass**

Run: `npx vitest run test/accountManager.core.test.ts test/accountManager.reconcile.test.ts`
Expected: PASS (fix the Task 8 constructor call if it errors on the missing `config`).

- [ ] **Step 9: Commit**

```bash
git add src/config.ts src/accountManager.ts test/config.test.ts test/accountManager.reconcile.test.ts test/accountManager.core.test.ts
git commit -m "feat: reconcileOnChange with configurable logout behavior"
```

---

## Task 10: Output formatting (table, symbols, relative time)

**Files:**
- Create: `src/format.ts`
- Test: `test/format.test.ts`

**Interfaces:**
- Consumes: `AccountView`, `OauthLabel`.
- Produces:
  - `formatRelative(iso: string, nowMs: number): string` — e.g. `just now`, `2d ago`.
  - `formatList(views: AccountView[], nowMs: number): string` — the aligned table with `●` on the active row; a friendly line when empty.
  - `formatCurrent(res: { saved: AccountView | null; label: OauthLabel | null }): string`
  - `SYMBOLS = { active: '●', ok: '✓', err: '✗', warn: '⚠', off: '○' }`

- [ ] **Step 1: Write the failing test** — `test/format.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { formatRelative, formatList, formatCurrent, SYMBOLS } from '../src/format.js';

const T = Date.parse('2026-07-31T12:00:00Z');

describe('format', () => {
  it('formatRelative gives coarse buckets', () => {
    expect(formatRelative('2026-07-31T11:59:30Z', T)).toBe('just now');
    expect(formatRelative('2026-07-31T11:00:00Z', T)).toBe('1h ago');
    expect(formatRelative('2026-07-29T12:00:00Z', T)).toBe('2d ago');
  });

  it('formatList marks the active row and counts accounts', () => {
    const out = formatList([
      { name: 'a@x.com', email: 'a@x.com', organizationName: 'ITR', savedAt: '2026-07-29T12:00:00Z', active: true },
      { name: 'b@x.com', email: 'b@x.com', savedAt: '2026-07-30T12:00:00Z', active: false },
    ], T);
    expect(out).toContain(`${SYMBOLS.active} a@x.com`);
    expect(out).toContain('(active)');
    expect(out).toContain('2 accounts');
  });

  it('formatList handles the empty case', () => {
    expect(formatList([], T)).toContain('No saved accounts');
  });

  it('formatCurrent shows the external-login note when unsaved', () => {
    expect(formatCurrent({ saved: null, label: { email: 'x@x.com' } })).toContain('not yet saved');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/format.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/format.ts`**

```ts
import type { AccountView, OauthLabel } from './types.js';

export const SYMBOLS = { active: '●', ok: '✓', err: '✗', warn: '⚠', off: '○' } as const;

export function formatRelative(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '—';
  const s = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7); if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30); if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

export function formatList(views: AccountView[], nowMs: number): string {
  if (views.length === 0) return '  No saved accounts. Log in with `claude`, then run `claude-p list` to capture it.';
  const nameW = Math.max(20, ...views.map((v) => v.email.length + 2));
  const header = `  ${pad('ACCOUNT', nameW)}${pad('ORG', 12)}SAVED`;
  const rows = views.map((v) => {
    const mark = v.active ? SYMBOLS.active : ' ';
    const org = v.organizationName ?? '—';
    const when = formatRelative(v.savedAt, nowMs) + (v.active ? '      (active)' : '');
    return `${mark} ${pad(v.email, nameW)}${pad(org, 12)}${when}`;
  });
  const count = `${views.length} account${views.length === 1 ? '' : 's'}`;
  return [header, ...rows, '', count].join('\n');
}

export function formatCurrent(res: { saved: AccountView | null; label: OauthLabel | null }): string {
  if (res.saved) {
    const org = res.saved.organizationName ? ` · ${res.saved.organizationName}` : '';
    const name = res.saved.displayName ? `${res.saved.displayName}${org}` : (res.saved.organizationName ?? '');
    return `${SYMBOLS.active} ${res.saved.email}${name ? `\n  ${name}` : ''}`;
  }
  if (res.label) return `${SYMBOLS.active} external login (${res.label.email}) — not yet saved\n  Run any claude-p command again after the session initializes to capture it.`;
  return `${SYMBOLS.off} no active Claude login`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/format.ts test/format.test.ts
git commit -m "feat: output formatting for list/current"
```

---

## Task 11: CLI commands (reconcile-first + list/current/switch/remove/rename)

**Files:**
- Create: `src/app.ts` (wires real deps into an `AccountManager`)
- Modify: `src/cli.ts` (register commands)
- Test: `test/cli.commands.test.ts`

**Interfaces:**
- Consumes: `AccountManager`, `createCredentialStore`, `MetadataStore`, `ProfileFile`, `ConfigStore`, `formatList`, `formatCurrent`, `SYMBOLS`.
- Produces:
  - `src/app.ts`: `createManager(env?: { platform?; home?; osUsername? }): AccountManager` — resolves paths under `home` (`~/.claude.json`, `~/.claude-profiles/accounts.json`, `~/.claude-profiles/config.json`) and builds the manager.
  - `src/cli.ts`: `buildProgram(deps?: { manager?: AccountManager; now?: () => number; out?: (s: string) => void; confirm?: (q: string) => Promise<boolean> })` — commands run `manager.reconcileOnChange()` first (best-effort), then their action. Injectable `manager`/`out`/`confirm` make commands testable without real I/O.

- [ ] **Step 1: Write the failing test** — `test/cli.commands.test.ts`

```ts
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
    canonical, saved: {} as Record<string, string>,
    isAvailable() { return true; },
    async readCanonical() { return this.canonical; },
    async writeCanonical(b: string) { this.canonical = b; },
    async readSaved(n: string) { return this.saved[n] ?? ''; },
    async writeSaved(n: string, b: string) { this.saved[n] = b; },
    async deleteSaved(n: string) { delete this.saved[n]; },
  } as CredentialStore & { canonical: string; saved: Record<string, string> };
}

function makeManager(canonical: string, profileJson?: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'clp-cli-'));
  const profilePath = join(dir, '.claude.json');
  if (profileJson !== undefined) writeFileSync(profilePath, JSON.stringify(profileJson));
  const store = memStore(canonical);
  const meta = new MetadataStore({ path: join(dir, 'accounts.json') });
  const profile = new ProfileFile({ path: profilePath });
  const mgr = new AccountManager({ store, meta, profile, config: { logoutBehavior: 'delete-switch' }, now: () => 'T0' });
  return { store, meta, mgr };
}

async function run(mgr: AccountManager, argv: string[], confirm = async () => true) {
  const lines: string[] = [];
  const program = buildProgram({ manager: mgr, now: () => Date.parse('2026-07-31T12:00:00Z'), out: (s) => lines.push(s), confirm });
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
    await meta.update((d) => d.accounts.push({ name: 'b@x.com', email: 'b@x.com', fingerprint: 'f', savedAt: 'T', oauthAccount: { emailAddress: 'b@x.com' } }));
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
    await run(mgr, ['remove', 'a@x.com', '-y'], async () => { asked = true; return true; });
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

  it('list --json prints machine-readable output', async () => {
    const { meta, mgr } = makeManager('', {});
    await meta.update((d) => d.accounts.push({ name: 'a@x.com', email: 'a@x.com', fingerprint: 'f', savedAt: '2026-07-30T00:00:00Z' }));
    const out = await run(mgr, ['list', '--json']);
    expect(JSON.parse(out)[0]).toMatchObject({ name: 'a@x.com', active: false });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/cli.commands.test.ts`
Expected: FAIL — commands not registered / `buildProgram` ignores `deps`.

- [ ] **Step 3: Implement `src/app.ts`**

```ts
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
```

- [ ] **Step 4: Rewrite `src/cli.ts` to register commands**

```ts
import { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { AccountManager } from './accountManager.js';
import { createManager } from './app.js';
import { formatList, formatCurrent, SYMBOLS } from './format.js';

export interface CliDeps {
  manager?: AccountManager;
  now?: () => number;
  out?: (s: string) => void;
  confirm?: (question: string) => Promise<boolean>;
}

async function defaultConfirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return answer === 'y' || answer === 'yes';
}

export function buildProgram(deps: CliDeps = {}): Command {
  const out = deps.out ?? ((s: string) => console.log(s));
  const now = deps.now ?? (() => Date.now());
  const confirm = deps.confirm ?? defaultConfirm;
  const manager = () => deps.manager ?? createManager();

  const program = new Command();
  program.name('claude-p').description('Switch between Claude Code logins').version('1.0.0').exitOverride();

  // Run reconcile before each command (best-effort — never blocks the command).
  async function reconcileFirst(mgr: AccountManager): Promise<void> {
    try { await mgr.reconcileOnChange(); } catch { /* ignore */ }
  }

  program.command('list').alias('ls').description('List saved accounts')
    .option('--json', 'machine-readable output')
    .action(async (opts: { json?: boolean }) => {
      const mgr = manager();
      await reconcileFirst(mgr);
      const views = await mgr.listAccounts();
      out(opts.json ? JSON.stringify(views, null, 2) : formatList(views, now()));
    });

  program.command('current').alias('status').description('Show the active login')
    .action(async () => {
      const mgr = manager();
      await reconcileFirst(mgr);
      out(formatCurrent(mgr.current()));
    });

  program.command('switch <name>').alias('use').description('Make <name> the active login')
    .action(async (name: string) => {
      const mgr = manager();
      await reconcileFirst(mgr);
      try {
        await mgr.switchTo(name);
        out(`${SYMBOLS.ok} Switched to ${name}\n  Running \`claude\` sessions keep the old login until restarted.`);
      } catch (e) {
        out(`${SYMBOLS.err} ${(e as Error).message}`);
        process.exitCode = 1;
      }
    });

  program.command('remove <name>').alias('rm').description('Forget a saved account')
    .option('-y, --yes', 'skip confirmation')
    .action(async (name: string, opts: { yes?: boolean }) => {
      const mgr = manager();
      await reconcileFirst(mgr);
      if (!opts.yes) {
        const ok = await confirm(`Remove saved account '${name}'? This deletes its stored credential.`);
        if (!ok) { out('Cancelled.'); return; }
      }
      await mgr.removeAccount(name);
      out(`${SYMBOLS.ok} Removed ${name}`);
    });

  program.command('rename <old> <new>').description('Relabel a saved account')
    .action(async (oldName: string, newName: string) => {
      const mgr = manager();
      await reconcileFirst(mgr);
      try {
        await mgr.renameAccount(oldName, newName);
        out(`${SYMBOLS.ok} Renamed ${oldName} → ${newName}`);
      } catch (e) {
        out(`${SYMBOLS.err} ${(e as Error).message}`);
        process.exitCode = 1;
      }
    });

  return program;
}
```

Note: `src/bin.ts` from Task 1 already calls `buildProgram()` with no deps — that path uses the real `createManager()`. No change needed there.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/cli.commands.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app.ts src/cli.ts test/cli.commands.test.ts
git commit -m "feat: CLI commands with reconcile-first (list/current/switch/remove/rename)"
```

---

## Task 12: `doctor` command

**Files:**
- Create: `src/doctor.ts`
- Modify: `src/cli.ts` (register `doctor`)
- Test: `test/doctor.test.ts`

**Interfaces:**
- Consumes: `CredentialStore`, `ProfileFile`, `Config`, `MetadataStore`.
- Produces (`src/doctor.ts`): `runDoctor(deps: { store: CredentialStore; profile: ProfileFile; meta: MetadataStore; config: Config; platform: NodeJS.Platform }): Promise<{ ok: boolean; report: string }>`. Also `buildDoctorDeps(env?): {...}` mirroring `createManager` wiring so the CLI can call it.

- [ ] **Step 1: Write the failing test** — `test/doctor.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDoctor } from '../src/doctor.js';
import { MetadataStore } from '../src/metadataStore.js';
import { ProfileFile } from '../src/profileFile.js';
import type { CredentialStore } from '../src/types.js';

function store(canonical: string): CredentialStore {
  return {
    isAvailable: () => true,
    readCanonical: async () => canonical,
    writeCanonical: async () => {},
    readSaved: async () => '',
    writeSaved: async () => {},
    deleteSaved: async () => {},
  };
}

function deps(canonical: string, profileJson?: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'clp-doc-'));
  const profilePath = join(dir, '.claude.json');
  if (profileJson !== undefined) writeFileSync(profilePath, JSON.stringify(profileJson));
  return {
    store: store(canonical),
    profile: new ProfileFile({ path: profilePath }),
    meta: new MetadataStore({ path: join(dir, 'accounts.json') }),
    config: { logoutBehavior: 'delete-switch' as const },
    platform: 'darwin' as NodeJS.Platform,
  };
}

describe('runDoctor', () => {
  it('passes when a login is present', async () => {
    const { ok, report } = await runDoctor(deps('BLOB', { oauthAccount: { emailAddress: 'a@x.com' } }));
    expect(ok).toBe(true);
    expect(report).toContain('a@x.com');
    expect(report).toContain('All checks passed');
  });

  it('fails and gives a hint when no canonical login exists', async () => {
    const { ok, report } = await runDoctor(deps('', {}));
    expect(ok).toBe(false);
    expect(report).toMatch(/log in|not found/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/doctor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/doctor.ts`**

```ts
import { homedir, userInfo, platform as osPlatform } from 'node:os';
import { join } from 'node:path';
import type { CredentialStore, Config } from './types.js';
import { ProfileFile } from './profileFile.js';
import { MetadataStore } from './metadataStore.js';
import { createCredentialStore } from './credentialStore.js';
import { ConfigStore } from './config.js';
import { SYMBOLS } from './format.js';

export interface DoctorDeps {
  store: CredentialStore;
  profile: ProfileFile;
  meta: MetadataStore;
  config: Config;
  platform: NodeJS.Platform;
}

interface Check { ok: boolean; label: string; detail: string; hint?: string; }

export async function runDoctor(deps: DoctorDeps): Promise<{ ok: boolean; report: string }> {
  const checks: { section: string; items: Check[] }[] = [];

  checks.push({ section: 'System', items: [
    { ok: true, label: 'platform', detail: `${deps.platform} (node ${process.version})` },
    { ok: deps.store.isAvailable(), label: 'credential backend', detail: deps.store.isAvailable() ? 'available' : 'unavailable', hint: 'This OS/backend is not supported yet.' },
  ]});

  const blob = await deps.store.readCanonical().catch(() => '');
  const label = deps.profile.peekLabel();
  checks.push({ section: 'Claude login', items: [
    { ok: !!blob, label: 'canonical slot', detail: blob ? 'present' : 'missing', hint: 'run `claude` and log in once, then `claude-p doctor`' },
    { ok: !!label, label: 'active identity', detail: label ? `${label.email}${label.organizationName ? ` · ${label.organizationName}` : ''}` : 'unknown', hint: 'wait for the session to initialize' },
  ]});

  const accounts = deps.meta.read().accounts;
  checks.push({ section: 'claude-profiles', items: [
    { ok: true, label: 'config', detail: `logout=${deps.config.logoutBehavior}` },
    { ok: true, label: 'store', detail: `${accounts.length} account${accounts.length === 1 ? '' : 's'}` },
  ]});

  const lines: string[] = ['', 'claude-profiles doctor', ''];
  let ok = true;
  let issues = 0;
  for (const group of checks) {
    lines.push(`  ${group.section}`);
    for (const c of group.items) {
      const sym = c.ok ? SYMBOLS.ok : SYMBOLS.err;
      if (!c.ok) { ok = false; issues++; }
      lines.push(`    ${sym} ${c.label.padEnd(18)} ${c.detail}`);
      if (!c.ok && c.hint) lines.push(`      → ${c.hint}`);
    }
    lines.push('');
  }
  lines.push(ok ? '  All checks passed.' : `  ${issues} issue${issues === 1 ? '' : 's'} found.`);
  return { ok, report: lines.join('\n') };
}

export function buildDoctorDeps(env?: { platform?: NodeJS.Platform; home?: string; osUsername?: string }): DoctorDeps {
  const platform = env?.platform ?? osPlatform();
  const home = env?.home ?? homedir();
  const osUsername = env?.osUsername ?? userInfo().username;
  return {
    store: createCredentialStore({ platform, home, osUsername }),
    profile: new ProfileFile({ path: join(home, '.claude.json') }),
    meta: new MetadataStore({ path: join(home, '.claude-profiles', 'accounts.json') }),
    config: new ConfigStore({ path: join(home, '.claude-profiles', 'config.json') }).load(),
    platform,
  };
}
```

- [ ] **Step 4: Register `doctor` in `src/cli.ts`**

Add this import at the top:
```ts
import { runDoctor, buildDoctorDeps } from './doctor.js';
```
Add before `return program;`:
```ts
  program.command('doctor').description('Diagnose credential path, config, and store')
    .action(async () => {
      const { ok, report } = await runDoctor(buildDoctorDeps());
      out(report);
      if (!ok) process.exitCode = 1;
    });
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run test/doctor.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite + typecheck + build**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean, all tests pass, coverage ≥ thresholds, `dist/bin.js` produced. Then smoke-test the real binary:
Run: `node dist/bin.js --help` and `node dist/bin.js doctor`
Expected: help text prints; doctor prints the checklist (on macOS it may raise a Keychain ACL prompt — click Allow).

- [ ] **Step 7: Commit**

```bash
git add src/doctor.ts src/cli.ts test/doctor.test.ts
git commit -m "feat: doctor command"
```

---

## Task 13: README + packaging polish

**Files:**
- Create: `README.md`, `tsup.config.ts` (optional, for shebang), `LICENSE`
- Modify: `package.json` (`prepublishOnly`)

**Interfaces:** none (docs/packaging).

- [ ] **Step 1: Write `README.md`** — cover install (`npm i -g claude-profiles`), the command table from the spec, the `logoutBehavior` config, the macOS ACL-prompt note, and the "capture is lazy (reconcile-on-command)" behavior. Include the mockups from the design doc.

- [ ] **Step 2: Ensure the shebang survives bundling** — verify `dist/bin.js` starts with `#!/usr/bin/env node` after `npm run build`. If tsup dropped it, add `tsup.config.ts`:

```ts
import { defineConfig } from 'tsup';
export default defineConfig({ entry: ['src/bin.ts'], format: ['esm'], target: 'node18', clean: true, banner: { js: '#!/usr/bin/env node' } });
```
and simplify the `build` script to `tsup`.

- [ ] **Step 3: Add `prepublishOnly` guard to `package.json`**

```json
"prepublishOnly": "npm run typecheck && npm test && npm run build"
```

- [ ] **Step 4: Verify a local global install works**

Run: `npm run build && npm pack --dry-run` (confirm only `dist/` + `README.md` + `package.json` + `LICENSE` are included), then optionally `npm i -g .` and `claude-p --help`.
Expected: `claude-p` resolves on PATH and prints help.

- [ ] **Step 5: Commit**

```bash
git add README.md LICENSE package.json tsup.config.ts
git commit -m "docs: README and packaging polish"
```

---

## Self-Review

**Spec coverage** (each spec section → task):
- Cross-platform credential swap → Tasks 3 (FileStore), 4 (MacKeychainStore), 5 (factory). Per-OS verification → Task 0.
- MetadataStore atomic + lock + `lastActive` → Task 6.
- ProfileFile (labels + restore on switch, atomic) → Task 7.
- Identity match (uuid→email→fingerprint) + token-rotation refresh → Tasks 8, 9.
- Reconcile-on-command + configurable logout behavior → Tasks 9, 11 (reconcile-first wiring).
- No manual `save`; rename for custom names → Task 8 (`renameAccount`), CLI has no save command (Task 11).
- Commands list/current/switch/remove(-y)/rename/doctor + `--json` → Tasks 11, 12.
- Error handling (unsupported OS, reconcile never throws, switch-missing) → Tasks 9 (never-throws test), 11 (switch error path), 12 (doctor unsupported).
- Testing ≥90% + no daemon test → coverage thresholds in Task 1; reconcile/logout tests in Task 9.
- Distribution (npm, bin, no native) → Tasks 1, 13.

**Placeholder scan:** every code/test step contains real content; no "TBD"/"add error handling"/"similar to Task N".

**Type consistency:** `CredentialStore` (6 methods) is identical across Tasks 2/3/4/5/8/11/12. `AccountManager` deps `{ store, meta, profile, config, now? }` — `config` added in Task 9; Task 8's test constructor call is explicitly updated in Task 9 Step 7. `AccountView`/`AccountMeta`/`StoreData`/`OauthLabel` defined once in Task 2 and reused verbatim. `MetadataStore.update(mutator)` and `.read()` used consistently. `formatList(views, nowMs)` / `formatCurrent(res)` signatures match their CLI call sites in Task 11.

**Known follow-ups (out of v1 scope, noted for later):** Windows Credential Manager backend if Task 0 shows creds aren't file-based; import from the ClaudeSteps extension store; optional background daemon for instant capture.
