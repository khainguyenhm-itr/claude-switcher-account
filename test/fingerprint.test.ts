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
