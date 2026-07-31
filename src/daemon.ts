import { watchFile, unwatchFile } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AccountManager } from './accountManager.js';

export interface ReconcileResult {
  autoSaved: { email: string; name: string } | null;
  removed: string | null;
  switchedTo: string | null;
}

/** Human line describing what a reconcile changed, or null if nothing changed. Pure + testable. */
export function formatReconcileLog(r: ReconcileResult): string | null {
  if (r.autoSaved) return `captured new login ${r.autoSaved.email}`;
  if (r.removed && r.switchedTo) return `logged out of ${r.removed} — switched to ${r.switchedTo}`;
  if (r.switchedTo) return `logged out — switched to ${r.switchedTo}`;
  if (r.removed) return `logged out — removed ${r.removed}`;
  return null;
}

/** Run one reconcile and log what changed. Never throws. */
export async function reconcileAndLog(manager: AccountManager, log: (s: string) => void): Promise<void> {
  try {
    const r = await manager.reconcileOnChange();
    const msg = formatReconcileLog(r);
    if (msg) log(`[claudep] ${msg}`);
  } catch {
    /* never throw from the watcher */
  }
}

export interface DaemonOptions {
  watchPath?: string;
  intervalMs?: number;
  log?: (s: string) => void;
  /** Injectable file watcher (defaults to fs.watchFile). Returns an unsubscribe function. */
  watch?: (path: string, intervalMs: number, onChange: () => void) => () => void;
}

/**
 * Start watching ~/.claude.json and reconcile on every change — instant capture of new logins and
 * instant handling of switches/logouts. Uses polling (fs.watchFile) so it survives Claude's atomic
 * file replacement. Runs one reconcile immediately. Returns a stop() function.
 */
export function startDaemon(manager: AccountManager, opts: DaemonOptions = {}): () => void {
  const path = opts.watchPath ?? join(homedir(), '.claude.json');
  const interval = opts.intervalMs ?? 1000;
  const log = opts.log ?? ((s: string) => console.log(s));
  const subscribe = opts.watch ?? defaultWatch;

  log(`[claudep] watching ${path} every ${interval}ms — instant capture on login/switch/logout`);
  void reconcileAndLog(manager, log); // capture the current login right away
  return subscribe(path, interval, () => void reconcileAndLog(manager, log));
}

/* v8 ignore start -- real fs polling: needs the OS, not unit-testable */
function defaultWatch(path: string, intervalMs: number, onChange: () => void): () => void {
  const listener = () => onChange();
  watchFile(path, { interval: intervalMs }, listener);
  return () => unwatchFile(path, listener);
}
/* v8 ignore stop */
