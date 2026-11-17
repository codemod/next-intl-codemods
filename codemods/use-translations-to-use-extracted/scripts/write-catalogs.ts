/**
 * Pass 2: build plan.json + extraction catalogs from mined findings.
 *
 * JSSG entry (bundled at publish) so @formatjs / @eloqnt ship in the package —
 * no shell `node` / `npm install` step.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {Transform} from 'codemod:ast-grep';
import type TSX from 'codemod:ast-grep/langs/tsx';
import {acquireLock, getState, setState} from 'codemod:workflow';
import {buildApplyPlan} from './lib/build-plan.ts';
import {loadCatalogs} from './lib/catalog.ts';
import {pathExists} from './lib/fs-exists.ts';
import {assertCatalogsSupported, assertNextIntlSupportsPo} from './lib/guards.ts';
import {readParams} from './lib/params.ts';
import {artifactDir, findingsPath, planPath, reportPath} from './lib/paths.ts';
import type {ApplyPlan, FindingsFile, Report} from './lib/types.ts';
import {writeCatalogs} from './lib/write-catalogs.ts';

const FINDINGS_STATE = 'next_intl_findings';
const PLAN_READY_STATE = 'next_intl_plan_ready';

function findProjectRoot(file: string): string {
  let dir = path.dirname(file);
  for (;;) {
    if (
      pathExists(path.join(dir, '.codemod-next-intl')) ||
      pathExists(path.join(dir, 'messages')) ||
      pathExists(path.join(dir, 'package.json'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.dirname(file);
    dir = parent;
  }
}

function loadFindings(root: string): FindingsFile {
  const fromState = getState<FindingsFile>(FINDINGS_STATE);
  if (fromState && Object.keys(fromState.files).length > 0) return fromState;

  const file = findingsPath(root);
  if (!pathExists(file)) {
    throw new Error(`Missing findings at ${file}. Did the mine step run?`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as FindingsFile;
}

function logReport(report: Report, catalogsOut: string, localeCount: number, root: string) {
  console.log(
    [
      `files: ${report.files.changed}/${report.files.scanned} changed`,
      `bindings: ${report.bindings.converted} converted, ${report.bindings.skipped} skipped`,
      `calls: ${report.calls.converted} converted`,
      `messages: ${report.messages.total} (${report.messages.explicitIds} with explicit ids from ${report.conflicts.length} conflicting texts)`,
      `old keys never referenced statically: ${report.unreferencedKeys.length}`,
      `plan: ${planPath(root)}`,
      `report: ${reportPath(root)}`
    ].join('\n')
  );

  const reasons = new Map<string, number>();
  for (const binding of report.skipped) {
    for (const problem of binding.problems) {
      const reason = problem.reason.split(':')[0]!;
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
  }
  if (reasons.size > 0) {
    console.log('skipped because:');
    for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${count}× ${reason}`);
    }
  }
  if (report.valuesNotInMessage.length > 0) {
    console.log(
      `calls passing values the source text does not declare (expect tsc errors, see report): ${report.valuesNotInMessage.length}`
    );
  }
  if (report.files.withoutNextIntlImport.length > 0) {
    console.log(
      `files mentioning the hooks without a resolvable next-intl origin (left untouched): ${report.files.withoutNextIntlImport.length}`
    );
  }
  console.log(`wrote ${localeCount} catalogs to ${catalogsOut}`);
}

function buildAndWrite(root: string, options: {params?: Record<string, string>; dryRun?: boolean}): ApplyPlan {
  const params = readParams(options.params);

  assertNextIntlSupportsPo({projectRoot: root, format: params.format});
  const catalogs = loadCatalogs(params.messages, root, params.sourceLocale);
  assertCatalogsSupported({
    outDir: path.resolve(root, params.out),
    format: params.format,
    locales: catalogs.locales,
    sourceFiles: [...catalogs.filesByLocale.values()].flat()
  });

  const findings = loadFindings(root);
  const plan = buildApplyPlan(findings.files, catalogs, {
    projectRoot: root,
    sourceLocale: params.sourceLocale,
    namespace: params.namespace,
    format: params.format,
    outDir: params.out
  });

  fs.mkdirSync(artifactDir(root), {recursive: true});
  fs.writeFileSync(planPath(root), JSON.stringify(plan, null, 2));
  fs.writeFileSync(reportPath(root), JSON.stringify(plan.report, null, 2));

  // Always write plan/report; skip mutating extraction catalogs on dry-run.
  if (!options.dryRun) {
    writeCatalogs(plan.messages, {
      outDir: path.resolve(root, params.out),
      format: params.format,
      sourceLocale: params.sourceLocale,
      locales: catalogs.locales
    });
  }

  logReport(plan.report, params.out, catalogs.locales.length, root);
  if (options.dryRun) {
    console.log('dry-run: skipped writing extraction catalogs');
  }
  return plan;
}

const transform: Transform<TSX> = async (root, options) => {
  const projectRoot = findProjectRoot(root.filename());
  const release = acquireLock(PLAN_READY_STATE);
  try {
    if (getState<boolean>(PLAN_READY_STATE)) return null;
    buildAndWrite(projectRoot, {
      params: options?.params,
      dryRun: options?.dryRun === true
    });
    setState(PLAN_READY_STATE, true, true);
  } finally {
    release();
  }
  return null;
};

export default transform;
