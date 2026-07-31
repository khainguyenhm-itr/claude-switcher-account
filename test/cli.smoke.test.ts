import { describe, it, expect } from 'vitest';
import { buildProgram } from '../src/cli.js';
import { VERSION } from '../src/version.js';

describe('cli', () => {
  it('exposes name and version', () => {
    const program = buildProgram();
    expect(program.name()).toBe('claude-p');
    expect(program.version()).toBe(VERSION);
  });
});
