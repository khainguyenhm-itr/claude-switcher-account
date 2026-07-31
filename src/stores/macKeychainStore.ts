import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CredentialStore } from '../types.js';

const execFileP = promisify(execFile);

export const CLAUDE_SERVICE = 'Claude Code-credentials';
export const STORE_SERVICE = 'claude-profiles-accounts';

export type SecurityExec = (args: string[]) => Promise<string>;

/* v8 ignore start -- spawns the real `security` binary; injected in tests */
const defaultExec: SecurityExec = async (args) => {
  const { stdout } = await execFileP('security', args);
  return stdout;
};
/* v8 ignore stop */

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
    } catch {
      return '';
    }
  }

  async writeCanonical(blob: string): Promise<void> {
    await this.exec(['add-generic-password', '-U', '-s', CLAUDE_SERVICE, '-a', this.osUsername, '-w', blob]);
  }

  async readSaved(name: string): Promise<string> {
    try {
      const out = await this.exec(['find-generic-password', '-w', '-s', STORE_SERVICE, '-a', name]);
      return out.trim();
    } catch {
      return '';
    }
  }

  async writeSaved(name: string, blob: string): Promise<void> {
    await this.exec(['add-generic-password', '-U', '-s', STORE_SERVICE, '-a', name, '-w', blob]);
  }

  async deleteSaved(name: string): Promise<void> {
    try {
      await this.exec(['delete-generic-password', '-s', STORE_SERVICE, '-a', name]);
    } catch {
      /* already gone */
    }
  }
}
