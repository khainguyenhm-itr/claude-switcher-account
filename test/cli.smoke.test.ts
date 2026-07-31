import { describe, it, expect } from 'vitest';
import { buildProgram } from '../src/cli.js';

describe('cli', () => {
  it('exposes name and version', () => {
    const program = buildProgram();
    expect(program.name()).toBe('claude-p');
    expect(program.version()).toBe('1.0.0');
  });
});
