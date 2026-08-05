import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  launchdPlist,
  systemdUnit,
  windowsCreateArgs,
  installAutostart,
  uninstallAutostart,
  autostartInstalled,
  plistPath,
  systemdPath,
  legacyPlistPath,
  legacySystemdPath,
  LABEL,
  WIN_TASK,
  UNIT,
  LEGACY_LABEL,
  LEGACY_WIN_TASK,
  LEGACY_UNIT,
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

/** Simulates a machine still carrying the pre-rename autostart entry. */
function seedLegacy(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'legacy');
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

describe('identifiers', () => {
  it('name the current package, not the pre-rename one', () => {
    expect(LABEL).toBe('com.claude-switcher-account.daemon');
    expect(WIN_TASK).toBe('claude-switcher-account');
    expect(UNIT).toBe('claude-switcher-account.service');
    expect(systemdPath('/home/u')).toBe('/home/u/.config/systemd/user/claude-switcher-account.service');
  });

  it('keep the pre-rename identifiers separately, for cleanup only', () => {
    expect(LEGACY_LABEL).toBe('com.claude-login-switcher.daemon');
    expect(LEGACY_WIN_TASK).toBe('claude-login-switcher');
    expect(LEGACY_UNIT).toBe('claude-login-switcher.service');
  });

  it('never writes a legacy identifier into generated content', () => {
    expect(launchdPlist(paths)).not.toContain('claude-login-switcher');
    expect(systemdUnit(paths)).not.toContain('claude-login-switcher');
    expect(windowsCreateArgs(paths).join(' ')).not.toContain('claude-login-switcher');
  });
});

describe('legacy cleanup', () => {
  it('darwin install unloads and deletes the pre-rename plist', async () => {
    const home = mkdtempSync(join(tmpdir(), 'clp-lg-mac-'));
    seedLegacy(legacyPlistPath(home));
    const { exec, calls } = recordingExec();

    await installAutostart('darwin', paths, home, exec);

    expect(existsSync(legacyPlistPath(home))).toBe(false);
    expect(existsSync(plistPath(home))).toBe(true);
    expect(calls.some((c) => c[0] === 'launchctl' && c.includes('unload') && c.includes(legacyPlistPath(home)))).toBe(true);
  });

  it('linux install disables and deletes the pre-rename unit', async () => {
    const home = mkdtempSync(join(tmpdir(), 'clp-lg-lin-'));
    seedLegacy(legacySystemdPath(home));
    const { exec, calls } = recordingExec();

    await installAutostart('linux', paths, home, exec);

    expect(existsSync(legacySystemdPath(home))).toBe(false);
    expect(existsSync(systemdPath(home))).toBe(true);
    expect(calls.some((c) => c[0] === 'systemctl' && c.includes('disable') && c.includes(LEGACY_UNIT))).toBe(true);
  });

  it('win32 install deletes the pre-rename scheduled task', async () => {
    const { exec, calls } = recordingExec();

    await installAutostart('win32', paths, '/tmp', exec);

    expect(calls.some((c) => c[0] === 'schtasks' && c.includes('/Delete') && c.includes(LEGACY_WIN_TASK))).toBe(true);
  });

  it('uninstall also clears the pre-rename entry, for upgrades that skipped the daemon', async () => {
    const home = mkdtempSync(join(tmpdir(), 'clp-lg-un-'));
    seedLegacy(legacyPlistPath(home));
    const { exec } = recordingExec();

    await uninstallAutostart('darwin', home, exec);

    expect(existsSync(legacyPlistPath(home))).toBe(false);
  });

  it('install still succeeds when no legacy entry exists and its removal errors', async () => {
    const home = mkdtempSync(join(tmpdir(), 'clp-lg-clean-'));
    const exec: Exec = async (_file, args) => {
      // launchctl/systemctl/schtasks all fail on an entry that was never registered
      if (args.some((a) => a.includes('claude-login-switcher'))) throw new Error('No such process');
    };

    const msg = await installAutostart('darwin', paths, home, exec);

    expect(msg).toContain('launchd');
    expect(existsSync(plistPath(home))).toBe(true);
  });

  it('reports autostart installed when only the pre-rename entry is present', () => {
    const home = mkdtempSync(join(tmpdir(), 'clp-lg-det-'));
    seedLegacy(legacyPlistPath(home));

    expect(autostartInstalled('darwin', home)).toBe(true);
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
    expect(calls.some((c) => c[0] === 'schtasks' && c.includes('/Create') && c.includes(WIN_TASK))).toBe(true);
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
