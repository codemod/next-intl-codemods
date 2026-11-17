/**
 * Pass 3: apply plan.json AST/text rewrites.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {Transform} from 'codemod:ast-grep';
import type TSX from 'codemod:ast-grep/langs/tsx';
import {useMetricAtom} from 'codemod:metrics';
import {applyFilePlanToSource} from './lib/apply-text.ts';
import {pathExists} from './lib/fs-exists.ts';
import {planPath} from './lib/paths.ts';
import type {ApplyPlan, FilePlan} from './lib/types.ts';

const converted = useMetricAtom('next_intl_call_converted');
const bindingMetric = useMetricAtom('next_intl_binding');

function metricPath(filename: string, projectRoot: string): string {
  const rel = path.relative(projectRoot, filename);
  return rel && !rel.startsWith('..') ? rel.split(path.sep).join('/') : filename;
}

function findProjectRoot(file: string): string {
  let dir = path.dirname(file);
  for (;;) {
    if (pathExists(path.join(dir, '.codemod-next-intl', 'plan.json'))) return dir;
    if (pathExists(path.join(dir, 'package.json'))) {
      // Prefer ancestor that has the artifact when present.
      let cursor = dir;
      for (;;) {
        if (pathExists(path.join(cursor, '.codemod-next-intl', 'plan.json'))) return cursor;
        const parent = path.dirname(cursor);
        if (parent === cursor) break;
        cursor = parent;
      }
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.dirname(file);
    dir = parent;
  }
}

function loadPlan(root: string): ApplyPlan | null {
  const file = planPath(root);
  if (!pathExists(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as ApplyPlan;
}

function normalizePath(p: string): string {
  return path.resolve(p);
}

const transform: Transform<TSX> = async (root) => {
  const filename = root.filename();
  const projectRoot = findProjectRoot(filename);
  const plan = loadPlan(projectRoot);
  if (!plan) return null;

  const filePlan = plan.files.find((f) => normalizePath(f.file) === normalizePath(filename));
  if (!filePlan) return null;

  const fileKey = metricPath(filename, projectRoot);
  for (const hook of ['use', 'get'] as const) {
    if (filePlan.convertHook[hook]) {
      bindingMetric.increment({file: fileKey, hook, outcome: 'converted'});
    }
  }
  if (filePlan.callRewrites.length > 0) {
    converted.increment({file: fileKey}, filePlan.callRewrites.length);
  }

  const bom = root.source().startsWith('\uFEFF') ? '\uFEFF' : '';
  const source = bom ? root.source().slice(1) : root.source();
  // Offsets in the plan were computed without a leading BOM when TS/jssg stripped it;
  // jssg source() may or may not include BOM — prefer matching plan offsets to non-BOM text.
  const next = applyFilePlanToSource(source, filePlan as FilePlan, 'tsx');
  if (next === null) return null;
  return bom + next;
};

export default transform;
