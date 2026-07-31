import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  launchdPlist,
  systemdUnit,
  windowsCreateArgs,
  installAutostart,
  uninstallAutostart,
  autostartInstalled,
  plistPath,
  systemdPath,
  LABEL,
  WIN_TASK,
  type Exec,
} from '../src/autostart.js';

const paths = { nodePath: '/usr/bin/node', binPath: '/opt/claude-p/bin.js', logPath: '/tmp/clp.log' };

function recordingExec(): { exec: Exec; calls: string[][] } {
  const calls: string[][] = [];
  const exec: Exec = async (file, args) => {
    calls.push([file, ...args]);
  };
  return { exec, calls };
}

describe('content generators', () => {
  it('launchdPlist embeds the label and daemon-run argv', () => {
    const plist = launchdPlist(paths);
    expect(plist).toContain(`<string>${LABEL}</string>`);
    expect(plist).toContain('<string>/usr/bin/node</string>');
    expect(plist).toContain('<string>/opt/claude-p/bin.js</string>');
    expect(plist).toContain('<string>daemon</string>');
    expect(plist).toContain('<key>KeepAlive</key><true/>');
  });

  it('systemdUnit sets ExecStart and Restart', () => {
    const unit = systemdUnit(paths);
    expect(unit).toContain('ExecStart=/usr/bin/node /opt/claude-p/bin.js daemon run');
    expect(unit).toContain('Restart=always');
  });

  it('windowsCreateArgs registers an on-logon task', () => {
    const args = windowsCreateArgs(paths);
    expect(args).toContain('/SC');
    expect(args).toContain('ONLOGON');
    expect(args).toContain(WIN_TASK);
  });
});

describe('installAutostart', () => {
  it('darwin writes the plist and loads it', async () => {
    const home = mkdtempSync(join(tmpdir(), 'clp-la-'));
    const { exec, calls } = recordingExec();
    const msg = await installAutostart('darwin', paths, home, exec);
    expect(existsSync(plistPath(home))).toBe(true);
    expect(calls.some((c) => c[0] === 'launchctl' && c.includes('load'))).toBe(true);
    expect(msg).toContain('launchd');
    expect(autostartInstalled('darwin', home)).toBe(true);
  });

  it('linux writes the systemd unit and enables it', async () => {
    const home = mkdtempSync(join(tmpdir(), 'clp-sd-'));
    const { exec, calls } = recordingExec();
    await installAutostart('linux', paths, home, exec);
    expect(existsSync(systemdPath(home))).toBe(true);
    expect(calls.some((c) => c[0] === 'systemctl' && c.includes('enable'))).toBe(true);
  });

  it('throws on an unsupported platform', async () => {
    await expect(installAutostart('aix' as NodeJS.Platform, paths, '/tmp', recordingExec().exec)).rejects.toThrow(/not supported/i);
  });

  it('win32 creates a scheduled task', async () => {
    const { exec, calls } = recordingExec();
    const msg = await installAutostart('win32', paths, '/tmp', exec);
    expect(calls[0]?.[0]).toBe('schtasks');
    expect(calls[0]).toContain('/Create');
    expect(msg).toContain(WIN_TASK);
  });
});

describe('uninstallAutostart', () => {
  it('darwin removes the plist', async () => {
    const home = mkdtempSync(join(tmpdir(), 'clp-un-'));
    const { exec } = recordingExec();
    await installAutostart('darwin', paths, home, exec);
    expect(existsSync(plistPath(home))).toBe(true);
    await uninstallAutostart('darwin', home, exec);
    expect(existsSync(plistPath(home))).toBe(false);
    expect(autostartInstalled('darwin', home)).toBe(false);
  });

  it('linux disables the unit and removes it', async () => {
    const home = mkdtempSync(join(tmpdir(), 'clp-unl-'));
    const { exec, calls } = recordingExec();
    await installAutostart('linux', paths, home, exec);
    expect(existsSync(systemdPath(home))).toBe(true);
    await uninstallAutostart('linux', home, exec);
    expect(existsSync(systemdPath(home))).toBe(false);
    expect(calls.some((c) => c[0] === 'systemctl' && c.includes('disable'))).toBe(true);
  });

  it('win32 deletes the scheduled task', async () => {
    const { exec, calls } = recordingExec();
    const msg = await uninstallAutostart('win32', '/tmp', exec);
    expect(calls.some((c) => c[0] === 'schtasks' && c.includes('/Delete'))).toBe(true);
    expect(msg).toContain(WIN_TASK);
  });

  it('throws on an unsupported platform', async () => {
    await expect(uninstallAutostart('aix' as NodeJS.Platform, '/tmp', recordingExec().exec)).rejects.toThrow(/not supported/i);
  });

  it('autostartInstalled is false on win32 (no file check)', () => {
    expect(autostartInstalled('win32', '/tmp')).toBe(false);
  });
});
