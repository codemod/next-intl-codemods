import path from 'node:path';
import {pathExists} from './fs-exists.ts';

/**
 * Workflow/JSSG target directory. Prefer this over walking up from each file —
 * nested `package.json` / fixture `messages/` folders otherwise become false roots.
 */
export function projectRootFromOptions(options: {targetDir?: string} | undefined, fallbackFile?: string): string {
  if (options?.targetDir) return options.targetDir;
  if (!fallbackFile) return process.cwd();
  let dir = path.dirname(fallbackFile);
  for (;;) {
    if (
      pathExists(path.join(dir, '.codemod-next-intl')) ||
      pathExists(path.join(dir, 'messages')) ||
      pathExists(path.join(dir, 'package.json'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.dirname(fallbackFile);
    dir = parent;
  }
}
