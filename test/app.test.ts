import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createManager } from '../src/app.js';
import { AccountManager } from '../src/accountManager.js';

describe('createManager', () => {
  it('wires a working AccountManager for a given home/platform', () => {
    const home = mkdtempSync(join(tmpdir(), 'clp-app-'));
    const mgr = createManager({ platform: 'linux', home, osUsername: 'k' });
    expect(mgr).toBeInstanceOf(AccountManager);
  });
});
