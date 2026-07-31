import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import type { OauthLabel } from './types.js';

export interface ProfileFileOpts {
  path: string;
}

export class ProfileFile {
  private readonly path: string;
  constructor(opts: ProfileFileOpts) {
    this.path = opts.path;
  }

  private read(): Record<string, unknown> | null {
    try {
      const d = JSON.parse(readFileSync(this.path, 'utf8'));
      return d && typeof d === 'object' ? d : null;
    } catch {
      return null;
    }
  }

  peekOauthAccount(): Record<string, unknown> | undefined {
    const oa = this.read()?.oauthAccount;
    return oa && typeof oa === 'object' ? (oa as Record<string, unknown>) : undefined;
  }

  peekLabel(): OauthLabel | null {
    const oa = this.peekOauthAccount();
    const email = typeof oa?.emailAddress === 'string' ? oa.emailAddress : undefined;
    if (!email) return null;
    return {
      email,
      displayName: typeof oa?.displayName === 'string' ? oa.displayName : undefined,
      organizationName: typeof oa?.organizationName === 'string' ? oa.organizationName : undefined,
    };
  }

  currentIdentity(): { uuid?: string; email?: string } {
    const oa = this.peekOauthAccount();
    return {
      uuid: typeof oa?.accountUuid === 'string' ? oa.accountUuid : undefined,
      email: typeof oa?.emailAddress === 'string' ? oa.emailAddress : undefined,
    };
  }

  applyOauthAccount(snapshot: Record<string, unknown> | undefined): void {
    let d = this.read();
    if (!d) {
      if (!snapshot) return; // no file and nothing to restore
      d = {};
    }
    if (snapshot) d.oauthAccount = snapshot;
    else delete d.oauthAccount;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp-${process.pid}`;
      writeFileSync(tmp, JSON.stringify(d, null, 2));
      renameSync(tmp, this.path);
    } catch {
      /* best-effort: leave the file as-is */
    }
  }
}
