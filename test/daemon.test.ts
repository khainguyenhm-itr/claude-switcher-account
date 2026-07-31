import { describe, it, expect } from 'vitest';
import { formatReconcileLog, reconcileAndLog, startDaemon, type ReconcileResult } from '../src/daemon.js';
import type { AccountManager } from '../src/accountManager.js';

function fakeManager(result: ReconcileResult, onCall?: () => void): AccountManager {
  return {
    reconcileOnChange: async () => {
      onCall?.();
      return result;
    },
  } as unknown as AccountManager;
}

const empty: ReconcileResult = { autoSaved: null, removed: null, switchedTo: null };

describe('formatReconcileLog', () => {
  it('describes each transition', () => {
    expect(formatReconcileLog({ ...empty, autoSaved: { email: 'a@x.com', name: 'a@x.com' } })).toContain('captured new login a@x.com');
    expect(formatReconcileLog({ ...empty, removed: 'a', switchedTo: 'b' })).toBe('logged out of a — switched to b');
    expect(formatReconcileLog({ ...empty, switchedTo: 'b' })).toBe('logged out — switched to b');
    expect(formatReconcileLog({ ...empty, removed: 'a' })).toBe('logged out — removed a');
    expect(formatReconcileLog(empty)).toBeNull();
  });
});

describe('reconcileAndLog', () => {
  it('logs when something changed', async () => {
    const lines: string[] = [];
    await reconcileAndLog(fakeManager({ ...empty, autoSaved: { email: 'a@x.com', name: 'a@x.com' } }), (s) => lines.push(s));
    expect(lines.join('\n')).toContain('captured new login a@x.com');
  });

  it('logs nothing when nothing changed', async () => {
    const lines: string[] = [];
    await reconcileAndLog(fakeManager(empty), (s) => lines.push(s));
    expect(lines).toHaveLength(0);
  });

  it('never throws when reconcile fails', async () => {
    const throwing = { reconcileOnChange: async () => { throw new Error('boom'); } } as unknown as AccountManager;
    await expect(reconcileAndLog(throwing, () => {})).resolves.toBeUndefined();
  });
});

describe('startDaemon', () => {
  it('reconciles immediately and on every watch event, and stop() unsubscribes', () => {
    let calls = 0;
    let captured: (() => void) | null = null;
    let stopped = false;
    const mgr = fakeManager(empty, () => { calls++; });
    const stop = startDaemon(mgr, {
      watchPath: '/tmp/x',
      log: () => {},
      watch: (_p, _i, cb) => {
        captured = cb;
        return () => { stopped = true; };
      },
    });
    expect(calls).toBe(1); // initial reconcile
    captured!(); // simulate a file change
    expect(calls).toBe(2);
    stop();
    expect(stopped).toBe(true);
  });
});
