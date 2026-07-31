import { createHash } from 'node:crypto';

export function fingerprint(blob: string): string {
  return createHash('sha256').update(blob).digest('hex');
}
