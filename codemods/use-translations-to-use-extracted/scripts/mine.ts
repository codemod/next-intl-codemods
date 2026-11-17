/**
 * Pass 1: mine translation bindings into workflow state + findings.json artifact.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {Transform} from 'codemod:ast-grep';
import type TSX from 'codemod:ast-grep/langs/tsx';
import {useMetricAtom} from 'codemod:metrics';
import {acquireLock, getState, setState} from 'codemod:workflow';
import {pathExists} from './lib/fs-exists.ts';
import {mineFile} from './lib/mine-ast.ts';
import {artifactDir, findingsPath} from './lib/paths.ts';
import {projectRootFromOptions} from './lib/project-root.ts';
import type {FindingsFile} from './lib/types.ts';

const mined = useMetricAtom('next_intl_binding_mined');

const FINDINGS_STATE = 'next_intl_findings';

function metricPath(filename: string, projectRoot: string): string {
  const rel = path.relative(projectRoot, filename);
  return rel && !rel.startsWith('..') ? rel.split(path.sep).join('/') : filename;
}

function readFindings(file: string): FindingsFile {
  if (!pathExists(file)) return {files: {}};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as FindingsFile;
  } catch {
    return {files: {}};
  }
}

const transform: Transform<TSX> = async (root, options) => {
  const findings = mineFile(root);
  const file = root.filename();
  const projectRoot = projectRootFromOptions(options, file);
  const fileKey = metricPath(file, projectRoot);

  for (const binding of findings.bindings) {
    mined.increment({
      file: fileKey,
      hook: binding.hook,
      outcome: binding.problems.length > 0 ? 'problem' : 'ok'
    });
  }

  const release = acquireLock(FINDINGS_STATE);
  try {
    const existing = (getState<FindingsFile>(FINDINGS_STATE) ?? {files: {}}) as FindingsFile;
    existing.files[file] = findings;
    setState(FINDINGS_STATE, existing, true);

    const dir = artifactDir(projectRoot);
    fs.mkdirSync(dir, {recursive: true});
    const onDisk = readFindings(findingsPath(projectRoot));
    onDisk.files[file] = findings;
    fs.writeFileSync(findingsPath(projectRoot), JSON.stringify(onDisk, null, 2));
  } finally {
    release();
  }

  return null;
};

export default transform;
