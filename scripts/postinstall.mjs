// Best-effort: on a global install, turn on the instant-capture daemon so the user
// doesn't have to run `claude-p daemon install` by hand. Never fails the install.
// Opt out with CLAUDE_P_NO_DAEMON=1. Undo any time with `claude-p daemon uninstall`.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const skip =
  process.env.npm_config_global !== 'true' || // only for `npm i -g`, never local dev installs
  process.env.CI ||
  process.env.CLAUDE_P_NO_DAEMON ||
  !['darwin', 'linux', 'win32'].includes(process.platform);

if (!skip) {
  const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'bin.js');
  if (existsSync(bin)) {
    try {
      spawnSync(process.execPath, [bin, 'daemon', 'install'], { stdio: 'inherit', timeout: 20000 });
    } catch {
      /* best-effort — never break the install */
    }
  }
}
process.exit(0);
