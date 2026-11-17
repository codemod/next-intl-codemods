/**
 * Fallback miner used when workflow state / findings.json are unavailable
 * (notably under `--dry-run`, which neither persists state across steps nor
 * allows real-disk fs writes).
 */
import fs from 'node:fs';
import path from 'node:path';
import {parse} from 'codemod:ast-grep';
import type TSX from 'codemod:ast-grep/langs/tsx';
import {mineFile} from './mine-ast.ts';
import type {FileFindings, FindingsFile} from './types.ts';

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);
const SKIP_DIR = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  '.codemod-next-intl',
  '.git',
  'coverage'
]);

function rewriteFilePaths(findings: FileFindings, file: string): FileFindings {
  return {
    ...findings,
    file,
    bindings: findings.bindings.map((binding) => ({...binding, file}))
  };
}

function listSourceFiles(projectRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, {withFileTypes: true});
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith('.') && name !== '.') continue;
      const full = path.join(dir, name);
      if (entry.isDirectory()) {
        if (SKIP_DIR.has(name)) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(name);
      if (!SOURCE_EXT.has(ext)) continue;
      if (name.endsWith('.d.ts')) continue;
      out.push(full);
    }
  };
  walk(projectRoot);
  return out;
}

/**
 * Parse every source file under `projectRoot` and mine next-intl bindings.
 * Uses `parse()` (no per-file semantic graph) — enough for direct next-intl
 * imports; barrel/re-export resolution may be weaker than the mine step.
 */
export function collectFindingsFromTree(projectRoot: string): FindingsFile {
  const files: FindingsFile['files'] = {};
  for (const file of listSourceFiles(projectRoot)) {
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!/\b(?:use|get)Translations\b/.test(content)) continue;
    try {
      const root = parse<TSX>('tsx', content);
      files[file] = rewriteFilePaths(mineFile(root), file);
    } catch {
      // Skip unparseable files; apply will leave them untouched.
    }
  }
  return {files};
}
