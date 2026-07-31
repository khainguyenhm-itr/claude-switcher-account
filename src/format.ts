import type { AccountView, OauthLabel } from './types.js';

export const SYMBOLS = { active: '●', ok: '✓', err: '✗', warn: '⚠', off: '○' } as const;

export function formatRelative(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '—';
  const s = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

export function formatList(views: AccountView[], nowMs: number): string {
  if (views.length === 0) {
    return '  No saved accounts. Log in with `claude`, then run `claude-p list` to capture it.';
  }
  const nameW = Math.max(20, ...views.map((v) => v.email.length + 2));
  const header = `  ${pad('ACCOUNT', nameW)}${pad('ORG', 12)}SAVED`;
  const rows = views.map((v) => {
    const mark = v.active ? SYMBOLS.active : ' ';
    const org = v.organizationName ?? '—';
    const when = formatRelative(v.savedAt, nowMs) + (v.active ? '      (active)' : '');
    return `${mark} ${pad(v.email, nameW)}${pad(org, 12)}${when}`;
  });
  const count = `${views.length} account${views.length === 1 ? '' : 's'}`;
  return [header, ...rows, '', count].join('\n');
}

export function formatCurrent(res: { saved: AccountView | null; label: OauthLabel | null }): string {
  if (res.saved) {
    const org = res.saved.organizationName ? ` · ${res.saved.organizationName}` : '';
    const name = res.saved.displayName ? `${res.saved.displayName}${org}` : (res.saved.organizationName ?? '');
    return `${SYMBOLS.active} ${res.saved.email}${name ? `\n  ${name}` : ''}`;
  }
  if (res.label) {
    return `${SYMBOLS.active} external login (${res.label.email}) — not yet saved\n  Run any claude-p command again after the session initializes to capture it.`;
  }
  return `${SYMBOLS.off} no active Claude login`;
}
