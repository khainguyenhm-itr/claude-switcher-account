import type { AccountView } from './types.js';
import type { Colors } from './color.js';
import { orderAccounts } from './order.js';

export const SYMBOLS = { active: '●', ok: '✓', err: '✗', warn: '!', off: '○' } as const;

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

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

const ORG_MAX = 20;

export interface ListOptions {
  /** Email of an active login that isn't among the saved accounts yet (folds in the old `current` note). */
  external?: string;
}

/** Numbered, colored account list. `colors` is an injected colorizer so the output stays pure and
 *  colors vanish when disabled (pipes / NO_COLOR / --json). Accounts are shown in `orderAccounts`
 *  order, so the printed numbers match `claudep <n>`. */
export function formatList(views: AccountView[], nowMs: number, colors: Colors, opts: ListOptions = {}): string {
  const header = `  ${colors.bold('claudep')} ${colors.dim(`· ${views.length} account${views.length === 1 ? '' : 's'}`)}`;

  if (views.length === 0) {
    return [
      header,
      colors.dim('  ──────────────────────────────────────────'),
      colors.dim('  No saved accounts yet.'),
      colors.dim(`  → log in with ${colors.cyan('claude')}, then run ${colors.cyan('claudep list')}`),
    ].join('\n');
  }

  const ordered = orderAccounts(views);
  const idxW = String(ordered.length).length;
  const emailW = Math.max(...ordered.map((v) => v.email.length));
  const orgW = Math.min(ORG_MAX, Math.max(...ordered.map((v) => (v.organizationName ?? '—').length)));

  const rows = ordered.map((v, i) => {
    const idx = colors.dim(pad(String(i + 1), idxW));
    const mark = v.active ? colors.green(SYMBOLS.active) : ' ';
    const email = v.active ? colors.green(pad(v.email, emailW)) : pad(v.email, emailW);
    const org = colors.dim(pad(truncate(v.organizationName ?? '—', ORG_MAX), orgW));
    const when = v.active ? colors.green('active') : colors.dim(formatRelative(v.savedAt, nowMs));
    return `  ${idx}  ${mark} ${email}  ${org}  ${when}`;
  });

  const lines = [header, colors.dim('  ──────────────────────────────────────────'), ...rows, ''];

  if (opts.external) {
    lines.push(
      `  ${colors.yellow(SYMBOLS.warn)} ${colors.dim(`${opts.external} is active but not saved yet`)}`,
      colors.dim('    run any command again to capture it'),
    );
  }
  if (ordered.length > 1) lines.push(colors.dim('  → claudep <n> to switch'));

  return lines.join('\n').replace(/\n+$/, '');
}
