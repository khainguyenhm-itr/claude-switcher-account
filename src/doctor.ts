import { homedir, userInfo, platform as osPlatform } from 'node:os';
import { join } from 'node:path';
import type { CredentialStore, Config } from './types.js';
import { ProfileFile } from './profileFile.js';
import { MetadataStore } from './metadataStore.js';
import { createCredentialStore } from './credentialStore.js';
import { ConfigStore } from './config.js';
import { SYMBOLS } from './format.js';
import { makeColors, type Colors } from './color.js';

export interface DoctorDeps {
  store: CredentialStore;
  profile: ProfileFile;
  meta: MetadataStore;
  config: Config;
  platform: NodeJS.Platform;
}

interface Check {
  ok: boolean;
  label: string;
  detail: string;
  hint?: string;
}

export async function runDoctor(
  deps: DoctorDeps,
  colors: Colors = makeColors(false),
): Promise<{ ok: boolean; report: string }> {
  const checks: { section: string; items: Check[] }[] = [];

  checks.push({
    section: 'System',
    items: [
      { ok: true, label: 'platform', detail: `${deps.platform} (node ${process.version})` },
      {
        ok: deps.store.isAvailable(),
        label: 'credential backend',
        detail: deps.store.isAvailable() ? 'available' : 'unavailable',
        hint: 'This OS/backend is not supported yet.',
      },
    ],
  });

  const blob = await deps.store.readCanonical().catch(() => '');
  const label = deps.profile.peekLabel();
  checks.push({
    section: 'Claude login',
    items: [
      {
        ok: !!blob,
        label: 'canonical slot',
        detail: blob ? 'present' : 'missing',
        hint: 'run `claude` and log in once, then `claudep doctor`',
      },
      {
        ok: !!label,
        label: 'active identity',
        detail: label ? `${label.email}${label.organizationName ? ` · ${label.organizationName}` : ''}` : 'unknown',
        hint: 'wait for the session to initialize',
      },
    ],
  });

  const accounts = deps.meta.read().accounts;
  checks.push({
    section: 'Store',
    items: [
      { ok: true, label: 'config', detail: `logout=${deps.config.logoutBehavior}` },
      { ok: true, label: 'accounts', detail: `${accounts.length} saved` },
    ],
  });

  const lines: string[] = [
    `  ${colors.bold('claudep')} ${colors.dim('· doctor')}`,
    colors.dim('  ──────────────────────────────────────────'),
  ];
  let ok = true;
  let issues = 0;
  for (const group of checks) {
    lines.push(`  ${colors.bold(group.section)}`);
    for (const c of group.items) {
      const sym = c.ok ? colors.green(SYMBOLS.ok) : colors.red(SYMBOLS.err);
      if (!c.ok) {
        ok = false;
        issues++;
      }
      lines.push(`    ${sym} ${c.label.padEnd(18)} ${colors.dim(c.detail)}`);
      if (!c.ok && c.hint) lines.push(colors.dim(`      → ${c.hint}`));
    }
  }
  lines.push('');
  lines.push(
    ok
      ? `  ${colors.green(SYMBOLS.ok)} All checks passed`
      : `  ${colors.red(SYMBOLS.err)} ${issues} issue${issues === 1 ? '' : 's'} found`,
  );
  return { ok, report: lines.join('\n') };
}

export function buildDoctorDeps(env?: { platform?: NodeJS.Platform; home?: string; osUsername?: string }): DoctorDeps {
  const platform = env?.platform ?? osPlatform();
  const home = env?.home ?? homedir();
  const osUsername = env?.osUsername ?? userInfo().username;
  return {
    store: createCredentialStore({ platform, home, osUsername }),
    profile: new ProfileFile({ path: join(home, '.claude.json') }),
    meta: new MetadataStore({ path: join(home, '.claude-profiles', 'accounts.json') }),
    config: new ConfigStore({ path: join(home, '.claude-profiles', 'config.json') }).load(),
    platform,
  };
}
