#!/usr/bin/env node
import { buildProgram } from './cli.js';

const program = buildProgram();
try {
  await program.parseAsync(process.argv);
} catch (err) {
  // commander throws on --help/--version/bad input under exitOverride
  const code = (err as { exitCode?: number }).exitCode ?? 1;
  process.exit(code);
}
