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
import type {FindingsFile} from './lib/types.ts';

const mined = useMetricAtom('next_intl_binding_mined');

const FINDINGS_STATE = 'next_intl_findings';

const transform: Transform<TSX> = async (root) => {
  const findings = mineFile(root);
  const file = root.filename();

  for (const binding of findings.bindings) {
    mined.increment({
      file,
      hook: binding.hook,
      outcome: binding.problems.length > 0 ? 'problem' : 'ok'
    });
  }

  const release = acquireLock(FINDINGS_STATE);
  try {
    const existing = (getState<FindingsFile>(FINDINGS_STATE) ?? {files: {}}) as FindingsFile;
    existing.files[file] = findings;
    setState(FINDINGS_STATE, existing, true);

    // Also persist to disk for the Node write-catalogs step.
    const projectRoot = findProjectRoot(file);
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

function readFindings(file: string): FindingsFile {
  if (!pathExists(file)) return {files: {}};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as FindingsFile;
  } catch {
    return {files: {}};
  }
}

function findProjectRoot(file: string): string {
  // Prefer directory that contains messages/ or package.json walking up from the file.
  let dir = path.dirname(file);
  for (;;) {
    if (
      pathExists(path.join(dir, 'messages')) ||
      pathExists(path.join(dir, 'package.json')) ||
      pathExists(path.join(dir, ARTIFACT_MARKER))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.dirname(file);
    dir = parent;
  }
}

const ARTIFACT_MARKER = '.codemod-next-intl';

export default transform;
