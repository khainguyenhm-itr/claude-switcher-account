import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const execFileP = promisify(execFile);

export const LABEL = 'com.claude-login-switcher.daemon';
export const WIN_TASK = 'claude-login-switcher';

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
Description=claude-login-switcher instant login watcher

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
  return join(home, '.config', 'systemd', 'user', 'claude-login-switcher.service');
}

/** Best-effort "is autostart installed" by config-file presence (darwin/linux). */
export function autostartInstalled(platform: NodeJS.Platform, home = homedir()): boolean {
  if (platform === 'darwin') return existsSync(plistPath(home));
  if (platform === 'linux') return existsSync(systemdPath(home));
  return false;
}

// ---- installers (OS-mutating; exec injectable for tests) ----

function writeFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

export async function installAutostart(
  platform: NodeJS.Platform,
  paths: AutostartPaths,
  home = homedir(),
  exec: Exec = defaultExec,
): Promise<string> {
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
    await exec('systemctl', ['--user', 'enable', '--now', 'claude-login-switcher.service']);
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
  if (platform === 'darwin') {
    const plist = plistPath(home);
    await exec('launchctl', ['unload', plist]).catch(() => undefined);
    if (existsSync(plist)) rmSync(plist, { force: true });
    return 'launchd agent removed';
  }
  if (platform === 'linux') {
    await exec('systemctl', ['--user', 'disable', '--now', 'claude-login-switcher.service']).catch(() => undefined);
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
