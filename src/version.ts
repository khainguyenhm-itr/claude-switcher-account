import pkg from '../package.json';

// Single source of truth: name/version come from package.json (inlined at build by tsup).
export const PKG_NAME: string = pkg.name;
export const VERSION: string = pkg.version;

/** -1 if a < b, 0 if equal, 1 if a > b. Compares the first three numeric segments. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n) || 0);
  const pb = b.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export interface UpdateInfo {
  current: string;
  latest: string;
  isNewer: boolean;
}

/** Ask the npm registry for the latest published version. Returns null on any failure (offline, etc). */
export async function checkForUpdate(
  current: string,
  pkg: string = PKG_NAME,
  fetchFn: typeof fetch = fetch,
): Promise<UpdateInfo | null> {
  try {
    const res = await fetchFn(`https://registry.npmjs.org/${pkg}/latest`, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    if (!data.version) return null;
    return { current, latest: data.version, isNewer: compareVersions(data.version, current) > 0 };
  } catch {
    return null;
  }
}

export function formatVersion(info: UpdateInfo | null): string {
  const head = `claude-p ${VERSION}  (npm: ${PKG_NAME})`;
  if (!info) return `${head}\n  (could not check for updates)`;
  if (info.isNewer) return `${head}\n  ▲ v${info.latest} available — update: npm i -g ${PKG_NAME}`;
  return `${head}\n  ✓ up to date`;
}
