import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, statSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { StoreData } from './types.js';

const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface MetadataStoreOpts {
  path: string;
}

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
            rmSync(this.lockPath, { recursive: true, force: true });
            continue;
          }
        } catch {
          /* lock vanished between calls — retry */
        }
        if (Date.now() > deadline) throw new Error(`Timed out acquiring lock ${this.lockPath}`);
        await sleep(LOCK_RETRY_MS);
      }
    }
  }

  private releaseLock(): void {
    rmSync(this.lockPath, { recursive: true, force: true });
  }

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
