/** ANSI colorizer. Every method wraps its input when enabled, or returns it unchanged when not —
 *  so callers stay pure and colors vanish for pipes / NO_COLOR / --json. */
export interface Colors {
  green(s: string): string;
  dim(s: string): string;
  bold(s: string): string;
  cyan(s: string): string;
  red(s: string): string;
  yellow(s: string): string;
}

export function makeColors(enabled: boolean): Colors {
  const wrap = (code: string) => (s: string) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : s);
  return {
    green: wrap('32'),
    dim: wrap('2'),
    bold: wrap('1'),
    cyan: wrap('36'),
    red: wrap('31'),
    yellow: wrap('33'),
  };
}
