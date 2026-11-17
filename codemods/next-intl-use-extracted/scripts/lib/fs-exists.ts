import fs from 'node:fs';

/**
 * JSSG with `--allow-fs` / unrestricted capabilities uses LLRT's fs,
 * which may omit `existsSync`. Prefer `statSync` + try/catch.
 */
export function pathExists(p: string): boolean {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}
