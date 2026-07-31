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
