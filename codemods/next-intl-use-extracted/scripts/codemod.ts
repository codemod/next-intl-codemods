/**
 * Self-contained JSSG entry used by `jssg test` and as a single-step alternative.
 *
 * When `.codemod-next-intl/plan.json` exists (workflow apply path), delegates to apply.
 * Otherwise: mine → plan (+ catalogs) → apply for the current fixture/project.
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve, sep} from 'node:path';
import type {Transform} from 'codemod:ast-grep';
import type TSX from 'codemod:ast-grep/langs/tsx';
import {acquireLock, getState, setState} from 'codemod:workflow';
import {applyFilePlanToSource} from './lib/apply-text.ts';
import {buildApplyPlan} from './lib/build-plan.ts';
import {loadCatalogs} from './lib/catalog.ts';
import {pathExists} from './lib/fs-exists.ts';
import {assertCatalogsSupported, assertNextIntlSupportsPo} from './lib/guards.ts';
import {mineFile} from './lib/mine-ast.ts';
import {fixtureParams, readParams, type CodemodParams} from './lib/params.ts';
import {artifactDir, findingsPath, planPath, reportPath} from './lib/paths.ts';
import type {ApplyPlan, FindingsFile} from './lib/types.ts';
import {writeCatalogs} from './lib/write-catalogs.ts';

const FINDINGS_STATE = 'next_intl_findings_self';
const PLAN_STATE = 'next_intl_plan_build';

function fixtureRoot(filename: string): string {
  // jssg fixtures: .../tests/<case>/input/... or .../tests/<case>/input.tsx
  const parts = filename.split(sep);
  const inputIdx = parts.lastIndexOf('input');
  if (inputIdx >= 0) {
    return parts.slice(0, inputIdx + 1).join(sep);
  }
  // Single-file fixture: tests/case/input.tsx → tests/case
  const testsIdx = parts.lastIndexOf('tests');
  if (testsIdx >= 0 && parts[testsIdx + 1]) {
    return parts.slice(0, testsIdx + 2).join(sep);
  }
  let dir = dirname(filename);
  for (;;) {
    if (pathExists(join(dir, 'messages')) || pathExists(join(dir, 'package.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return dirname(filename);
    dir = parent;
  }
}

function resolveParams(options: {params?: unknown} | undefined, _root: string): CodemodParams {
  try {
    if (options?.params && typeof options.params === 'object') {
      return readParams(options.params);
    }
  } catch {
    // fall through to fixture defaults
  }
  // jssg fixtures: build plan without writing catalog files into the snapshot tree.
  return fixtureParams();
}

function ensurePlan(projectRoot: string, params: CodemodParams, findings: FindingsFile): ApplyPlan {
  const release = acquireLock(PLAN_STATE);
  try {
    assertNextIntlSupportsPo({projectRoot, format: params.format});
    const catalogs = loadCatalogs(params.messages, projectRoot, params.sourceLocale);
    assertCatalogsSupported({
      outDir: resolve(projectRoot, params.out),
      format: params.format,
      locales: catalogs.locales,
      sourceFiles: [...catalogs.filesByLocale.values()].flat()
    });

    const plan = buildApplyPlan(findings.files, catalogs, {
      projectRoot,
      sourceLocale: params.sourceLocale,
      namespace: params.namespace,
      format: params.format,
      outDir: params.out
    });

    if (params.out !== '__skip__') {
      mkdirSync(artifactDir(projectRoot), {recursive: true});
      writeFileSync(planPath(projectRoot), JSON.stringify(plan, null, 2));
      writeFileSync(reportPath(projectRoot), JSON.stringify(plan.report, null, 2));
      writeCatalogs(plan.messages, {
        outDir: resolve(projectRoot, params.out),
        format: params.format,
        sourceLocale: params.sourceLocale,
        locales: catalogs.locales
      });
    }

    return plan;
  } finally {
    release();
  }
}

const transform: Transform<TSX> = async (root, options) => {
  const filename = root.filename();
  const projectRoot = fixtureRoot(filename);

  // Workflow apply mode: plan already on disk.
  const existingPlanPath = planPath(projectRoot);
  if (pathExists(existingPlanPath) && !filename.includes(`${sep}tests${sep}`)) {
    const plan = JSON.parse(readFileSync(existingPlanPath, 'utf8')) as ApplyPlan;
    const filePlan = plan.files.find((f) => resolve(f.file) === resolve(filename));
    if (!filePlan) return null;
    const next = applyFilePlanToSource(root.source().replace(/^\uFEFF/, ''), filePlan);
    return next;
  }

  const params = resolveParams(options, projectRoot);
  const fileFindings = mineFile(root);

  const release = acquireLock(FINDINGS_STATE);
  let all: FindingsFile;
  try {
    all = (getState<FindingsFile>(FINDINGS_STATE) ?? {files: {}}) as FindingsFile;
    all.files[filename] = fileFindings;
    setState(FINDINGS_STATE, all, false);
    if (params.out !== '__skip__') {
      mkdirSync(artifactDir(projectRoot), {recursive: true});
      writeFileSync(findingsPath(projectRoot), JSON.stringify(all, null, 2));
    }
  } finally {
    release();
  }

  const plan = ensurePlan(projectRoot, params, all);
  const filePlan = plan.files.find((f) => resolve(f.file) === resolve(filename));
  if (!filePlan) {
    return null;
  }

  const bom = root.source().startsWith('\uFEFF') ? '\uFEFF' : '';
  const source = bom ? root.source().slice(1) : root.source();
  const next = applyFilePlanToSource(source, filePlan);
  if (next === null) return null;
  return bom + next;
};

export default transform;
