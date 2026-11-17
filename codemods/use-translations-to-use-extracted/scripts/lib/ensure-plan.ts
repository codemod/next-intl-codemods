import fs from 'node:fs';
import path from 'node:path';
import {acquireLock, getState, setState} from 'codemod:workflow';
import {buildApplyPlan} from './build-plan.ts';
import {loadCatalogs} from './catalog.ts';
import {pathExists} from './fs-exists.ts';
import {assertCatalogsSupported, assertNextIntlSupportsPo} from './guards.ts';
import {readParams} from './params.ts';
import {artifactDir, findingsPath, planPath, reportPath} from './paths.ts';
import {
  FINDINGS_STATE,
  PLAN_BY_FILE_STATE,
  PLAN_READY_STATE,
  PLAN_STATE
} from './state-keys.ts';
import type {ApplyPlan, FilePlan, FindingsFile, Report} from './types.ts';
import {writeCatalogs} from './write-catalogs.ts';

export {FINDINGS_STATE, PLAN_BY_FILE_STATE, PLAN_STATE} from './state-keys.ts';

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

function indexPlan(plan: ApplyPlan): Record<string, FilePlan> {
  const byFile: Record<string, FilePlan> = {};
  for (const filePlan of plan.files) {
    byFile[path.resolve(filePlan.file)] = filePlan;
  }
  return byFile;
}

function persistFindingsArtifact(root: string, findings: FindingsFile) {
  fs.mkdirSync(artifactDir(root), {recursive: true});
  fs.writeFileSync(findingsPath(root), JSON.stringify(findings, null, 2));
}

/**
 * Build plan + catalogs once per workflow run. Safe to call from every apply file.
 */
export function ensurePlan(options: {
  targetDir: string;
  params?: Record<string, string>;
  dryRun?: boolean;
}): {plan: ApplyPlan; byFile: Record<string, FilePlan>} {
  const cachedPlan = getState<ApplyPlan>(PLAN_STATE);
  const cachedIndex = getState<Record<string, FilePlan>>(PLAN_BY_FILE_STATE);
  if (cachedPlan && cachedIndex) return {plan: cachedPlan, byFile: cachedIndex};

  const release = acquireLock(PLAN_READY_STATE);
  try {
    const againPlan = getState<ApplyPlan>(PLAN_STATE);
    const againIndex = getState<Record<string, FilePlan>>(PLAN_BY_FILE_STATE);
    if (againPlan && againIndex) return {plan: againPlan, byFile: againIndex};

    const root = options.targetDir;
    const params = readParams(options.params);

    assertNextIntlSupportsPo({projectRoot: root, format: params.format});
    let catalogs;
    try {
      catalogs = loadCatalogs(params.messages, root, params.sourceLocale);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${message}\n` +
          `Looked under target directory: ${root}\n` +
          `Pass --param messages='…/{locale}.json' and --param sourceLocale=…, and run against your Next.js app (not this codemod package).`
      );
    }
    assertCatalogsSupported({
      outDir: path.resolve(root, params.out),
      format: params.format,
      locales: catalogs.locales,
      sourceFiles: [...catalogs.filesByLocale.values()].flat()
    });

    const findings = loadFindings(root);
    persistFindingsArtifact(root, findings);

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

    const byFile = indexPlan(plan);
    setState(PLAN_STATE, plan, true);
    setState(PLAN_BY_FILE_STATE, byFile, true);
    setState(PLAN_READY_STATE, true, true);
    return {plan, byFile};
  } finally {
    release();
  }
}
