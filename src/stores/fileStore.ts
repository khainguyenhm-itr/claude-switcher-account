// NOTE: canonicalPath is the location Claude Code stores its login on Linux/Windows.
// macOS was verified to use the Keychain (see MacKeychainStore); the Linux/Windows path
// ~/.claude/.credentials.json is the documented assumption and was NOT verified on a real
// machine — update here if a real Linux/Windows box shows a different location/format.
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
    try {
      return readFileSync(this.canonicalPath, 'utf8').trim();
    } catch {
      return '';
    }
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
