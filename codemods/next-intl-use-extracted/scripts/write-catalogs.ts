/**
 * Pass 2: build plan.json + extraction catalogs from findings.json.
 * Invoked as a workflow shell step (Node).
 */
import fs from 'node:fs';
import path from 'node:path';
import {buildApplyPlan} from './lib/build-plan.ts';
import {loadCatalogs} from './lib/catalog.ts';
import {pathExists} from './lib/fs-exists.ts';
import {assertCatalogsSupported, assertNextIntlSupportsPo} from './lib/guards.ts';
import {readParams} from './lib/params.ts';
import {artifactDir, findingsPath, planPath, reportPath} from './lib/paths.ts';
import type {FindingsFile} from './lib/types.ts';
import {writeCatalogs} from './lib/write-catalogs.ts';

function projectRootFromCwd(): string {
  return process.cwd();
}

function loadFindings(root: string): FindingsFile {
  const file = findingsPath(root);
  if (!pathExists(file)) {
    throw new Error(`Missing findings at ${file}. Did the mine step run?`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as FindingsFile;
}

function main() {
  const root = projectRootFromCwd();
  const params = readParams({
    messages: process.env.CODEMOD_PARAM_messages ?? process.env.NEXT_INTL_MESSAGES,
    sourceLocale: process.env.CODEMOD_PARAM_sourceLocale ?? process.env.NEXT_INTL_SOURCE_LOCALE,
    out: process.env.CODEMOD_PARAM_out ?? process.env.NEXT_INTL_OUT,
    format: process.env.CODEMOD_PARAM_format ?? process.env.NEXT_INTL_FORMAT,
    namespace: process.env.CODEMOD_PARAM_namespace ?? process.env.NEXT_INTL_NAMESPACE
  });

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

  writeCatalogs(plan.messages, {
    outDir: path.resolve(root, params.out),
    format: params.format,
    sourceLocale: params.sourceLocale,
    locales: catalogs.locales
  });

  console.log(
    [
      `files: ${plan.report.files.changed}/${plan.report.files.scanned} changed`,
      `bindings: ${plan.report.bindings.converted} converted, ${plan.report.bindings.skipped} skipped`,
      `calls: ${plan.report.calls.converted} converted`,
      `messages: ${plan.report.messages.total}`,
      `plan: ${planPath(root)}`
    ].join('\n')
  );
}

main();
