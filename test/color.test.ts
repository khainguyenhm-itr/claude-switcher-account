import { describe, it, expect } from 'vitest';
import { makeColors } from '../src/color.js';

describe('makeColors', () => {
  it('wraps text in ANSI codes when enabled', () => {
    const c = makeColors(true);
    expect(c.green('x')).toBe('\x1b[32mx\x1b[0m');
    expect(c.red('x')).toBe('\x1b[31mx\x1b[0m');
    expect(c.dim('x')).toBe('\x1b[2mx\x1b[0m');
    expect(c.bold('x')).toBe('\x1b[1mx\x1b[0m');
    expect(c.cyan('x')).toBe('\x1b[36mx\x1b[0m');
    expect(c.yellow('x')).toBe('\x1b[33mx\x1b[0m');
  });

  it('is the identity for every role when disabled', () => {
    const c = makeColors(false);
    for (const fn of [c.green, c.red, c.dim, c.bold, c.cyan, c.yellow]) {
      expect(fn('hello')).toBe('hello');
    }
  });
});
