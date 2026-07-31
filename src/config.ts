import { readFileSync } from 'node:fs';
import type { Config, LogoutBehavior } from './types.js';

const VALID: LogoutBehavior[] = ['delete-switch', 'keep-switch', 'keep', 'none'];
const DEFAULT: Config = { logoutBehavior: 'delete-switch' };

export interface ConfigStoreOpts {
  path: string;
}

export class ConfigStore {
  private readonly path: string;
  constructor(opts: ConfigStoreOpts) {
    this.path = opts.path;
  }

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
