import fs from 'node:fs';
import path from 'node:path';
import {pathExists} from './fs-exists.ts';
import type {CatalogFormat} from './types.ts';

export function assertNextIntlSupportsPo(options: {projectRoot: string; format: CatalogFormat}) {
  if (options.format !== 'po') return;
  for (let dir = options.projectRoot; ; dir = path.dirname(dir)) {
    const file = path.join(dir, 'node_modules/next-intl/package.json');
    if (pathExists(file)) {
      const {version} = JSON.parse(fs.readFileSync(file, 'utf8')) as {version: string};
      const [major, minor] = version.split('.').map(Number);
      if ((major ?? 0) < 4 || (major === 4 && (minor ?? 0) < 14)) {
        throw new Error(
          `next-intl ${version} is installed, but PO catalogs written by this codemod need next-intl 4.14.0 or newer: ` +
            'older extractors erase their translations on the next `next dev` or `next build`. ' +
            'Upgrade next-intl (including workspace packages), or use format=json with a separate out. Nothing was changed.'
        );
      }
      return;
    }
    if (dir === path.dirname(dir)) return;
  }
}

export function assertCatalogsSupported(options: {
  outDir: string;
  format: CatalogFormat;
  locales: string[];
  sourceFiles: string[];
}) {
  if (path.basename(options.outDir) === '__skip__' || options.outDir.endsWith(`${path.sep}__skip__`)) {
    return;
  }
  if (options.format === 'json') {
    for (const locale of options.locales) {
      const file = path.join(options.outDir, `${locale}.json`);
      if (options.sourceFiles.includes(file)) {
        throw new Error(
          `${file} is one of the old catalogs. Writing extraction catalogs there would let the extractor delete ` +
            'the translations of calls that could not be converted. Pass a different out. Nothing was changed.'
        );
      }
    }
    return;
  }
  for (const locale of options.locales) {
    const file = path.join(options.outDir, `${locale}.po`);
    if (pathExists(file) && fs.readFileSync(file, 'utf8').includes('X-Crowdin-SourceKey: msgstr')) {
      throw new Error(
        `${file} uses the previous PO layout of next-intl, which current versions refuse to read. ` +
          'Migrate it (https://github.com/amannn/next-intl/pull/2393), or delete it if it has no entries, ' +
          'then run the codemod again. Nothing was changed.'
      );
    }
  }
}
