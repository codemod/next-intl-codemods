/**
 * Pass 2: build plan once (from mined findings), write catalogs, then rewrite sources.
 * No semantic analysis — plan offsets + @jssg/utils import helpers are enough.
 */
import path from 'node:path';
import type {Transform} from 'codemod:ast-grep';
import type TSX from 'codemod:ast-grep/langs/tsx';
import {useMetricAtom} from 'codemod:metrics';
import {applyFilePlanToSource} from './lib/apply-text.ts';
import {ensurePlan} from './lib/ensure-plan.ts';
import {projectRootFromOptions} from './lib/project-root.ts';
import type {FilePlan} from './lib/types.ts';

const converted = useMetricAtom('next_intl_call_converted');
const bindingMetric = useMetricAtom('next_intl_binding');

function metricPath(filename: string, projectRoot: string): string {
  const rel = path.relative(projectRoot, filename);
  return rel && !rel.startsWith('..') ? rel.split(path.sep).join('/') : filename;
}

const transform: Transform<TSX> = async (root, options) => {
  const filename = root.filename();
  const projectRoot = projectRootFromOptions(options, filename);
  const {byFile} = ensurePlan({
    targetDir: projectRoot,
    params: options?.params,
    dryRun: options?.dryRun === true
  });

  const filePlan = byFile[path.resolve(filename)];
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
  const next = applyFilePlanToSource(source, filePlan as FilePlan, 'tsx');
  if (next === null) return null;
  return bom + next;
};

export default transform;
