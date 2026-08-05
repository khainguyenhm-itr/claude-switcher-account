import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const execFileP = promisify(execFile);

export const LABEL = 'com.claude-switcher-account.daemon';
export const WIN_TASK = 'claude-switcher-account';
export const UNIT = 'claude-switcher-account.service';

// Pre-rename identifiers (npm package was `claude-login-switcher`). Never written —
// only removed, so upgrading doesn't leave a second watcher running from the old
// entry, pointing at a binary npm has already deleted.
export const LEGACY_LABEL = 'com.claude-login-switcher.daemon';
export const LEGACY_WIN_TASK = 'claude-login-switcher';
export const LEGACY_UNIT = 'claude-login-switcher.service';

export type Exec = (file: string, args: string[]) => Promise<void>;
/* v8 ignore start -- spawns real launchctl/systemctl/schtasks; injected in tests */
const defaultExec: Exec = async (file, args) => {
  await execFileP(file, args);
};
/* v8 ignore stop */

export interface AutostartPaths {
  nodePath: string;
  binPath: string;
  logPath: string;
}

// ---- pure content generators (unit-tested) ----

export function launchdPlist(p: AutostartPaths): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${p.nodePath}</string>
    <string>${p.binPath}</string>
    <string>daemon</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${p.logPath}</string>
  <key>StandardErrorPath</key><string>${p.logPath}</string>
</dict>
</plist>
`;
}

export function systemdUnit(p: AutostartPaths): string {
  return `[Unit]
Description=claude-switcher-account instant login watcher

[Service]
ExecStart=${p.nodePath} ${p.binPath} daemon run
Restart=always
StandardOutput=append:${p.logPath}
StandardError=append:${p.logPath}

[Install]
WantedBy=default.target
`;
}

/** schtasks argv to register an on-logon task that runs the daemon. */
export function windowsCreateArgs(p: AutostartPaths): string[] {
  return ['/Create', '/F', '/SC', 'ONLOGON', '/TN', WIN_TASK, '/TR', `"${p.nodePath}" "${p.binPath}" daemon run`];
}

// ---- path helpers ----

export function plistPath(home = homedir()): string {
  return join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
}
export function systemdPath(home = homedir()): string {
  return join(home, '.config', 'systemd', 'user', UNIT);
}
export function legacyPlistPath(home = homedir()): string {
  return join(home, 'Library', 'LaunchAgents', `${LEGACY_LABEL}.plist`);
}
export function legacySystemdPath(home = homedir()): string {
  return join(home, '.config', 'systemd', 'user', LEGACY_UNIT);
}

/**
 * Best-effort "is autostart installed" by config-file presence (darwin/linux).
 * A leftover pre-rename entry counts: it is still a watcher running at logon, and
 * reporting it lets `daemon uninstall` be the thing that clears it.
 */
export function autostartInstalled(platform: NodeJS.Platform, home = homedir()): boolean {
  if (platform === 'darwin') return existsSync(plistPath(home)) || existsSync(legacyPlistPath(home));
  if (platform === 'linux') return existsSync(systemdPath(home)) || existsSync(legacySystemdPath(home));
  return false;
}

// ---- installers (OS-mutating; exec injectable for tests) ----

function writeFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

/**
 * Drop the pre-rename autostart entry if one is still registered.
 *
 * Entirely best-effort: on a machine that never ran the old package every command
 * here fails, which is expected and must never surface as an install failure.
 */
export async function removeLegacyAutostart(
  platform: NodeJS.Platform,
  home = homedir(),
  exec: Exec = defaultExec,
): Promise<void> {
  if (platform === 'darwin') {
    const plist = legacyPlistPath(home);
    await exec('launchctl', ['unload', plist]).catch(() => undefined);
    if (existsSync(plist)) rmSync(plist, { force: true });
    return;
  }
  if (platform === 'linux') {
    await exec('systemctl', ['--user', 'disable', '--now', LEGACY_UNIT]).catch(() => undefined);
    const unit = legacySystemdPath(home);
    if (existsSync(unit)) rmSync(unit, { force: true });
    return;
  }
  if (platform === 'win32') {
    await exec('schtasks', ['/Delete', '/F', '/TN', LEGACY_WIN_TASK]).catch(() => undefined);
  }
}

export async function installAutostart(
  platform: NodeJS.Platform,
  paths: AutostartPaths,
  home = homedir(),
  exec: Exec = defaultExec,
): Promise<string> {
  // Before registering the new entry, so the two watchers never overlap.
  await removeLegacyAutostart(platform, home, exec);
  if (platform === 'darwin') {
    const plist = plistPath(home);
    writeFile(plist, launchdPlist(paths));
    await exec('launchctl', ['unload', plist]).catch(() => undefined);
    await exec('launchctl', ['load', '-w', plist]);
    return `launchd agent installed at ${plist}`;
  }
  if (platform === 'linux') {
    const unit = systemdPath(home);
    writeFile(unit, systemdUnit(paths));
    await exec('systemctl', ['--user', 'daemon-reload']);
    await exec('systemctl', ['--user', 'enable', '--now', UNIT]);
    return `systemd user service installed at ${unit}`;
  }
  if (platform === 'win32') {
    await exec('schtasks', windowsCreateArgs(paths));
    return `Task Scheduler task '${WIN_TASK}' created (runs at logon)`;
  }
  throw new Error(`Autostart not supported on ${platform}.`);
}

export async function uninstallAutostart(
  platform: NodeJS.Platform,
  home = homedir(),
  exec: Exec = defaultExec,
): Promise<string> {
  // Also clears a pre-rename entry, which is the only path that reaches it when the
  // upgrade ran with CLAUDE_P_NO_DAEMON=1 and so never called installAutostart.
  await removeLegacyAutostart(platform, home, exec);
  if (platform === 'darwin') {
    const plist = plistPath(home);
    await exec('launchctl', ['unload', plist]).catch(() => undefined);
    if (existsSync(plist)) rmSync(plist, { force: true });
    return 'launchd agent removed';
  }
  if (platform === 'linux') {
    await exec('systemctl', ['--user', 'disable', '--now', UNIT]).catch(() => undefined);
    const unit = systemdPath(home);
    if (existsSync(unit)) rmSync(unit, { force: true });
    return 'systemd user service removed';
  }
  if (platform === 'win32') {
    await exec('schtasks', ['/Delete', '/F', '/TN', WIN_TASK]);
    return `Task Scheduler task '${WIN_TASK}' removed`;
  }
  throw new Error(`Autostart not supported on ${platform}.`);
}
