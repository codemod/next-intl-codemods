import fs from 'node:fs';
import path from 'node:path';
import createJsonCodec from '@eloqnt/format-json';
import createPoCodec from '@eloqnt/format-po';
import {pathExists} from './fs-exists.ts';
import type {CatalogFormat, PlannedMessage} from './types.ts';

type CodecMessage = {
  id: string;
  message: string;
  description: string[];
  references: Array<{path: string; line?: number; column?: number}>;
  [key: string]: unknown;
};

export function writeCatalogs(
  messages: PlannedMessage[],
  options: {outDir: string; format: CatalogFormat; sourceLocale: string; locales: string[]}
) {
  if (messages.length === 0) return;
  const codec = options.format === 'po' ? createPoCodec() : createJsonCodec();
  const extension = `.${options.format}`;
  fs.mkdirSync(options.outDir, {recursive: true});

  const sourceMessagesById = new Map<string, CodecMessage>();
  const localeList = [
    options.sourceLocale,
    ...options.locales.filter((locale) => locale !== options.sourceLocale)
  ];

  for (const locale of localeList) {
    const file = path.join(options.outDir, `${locale}${extension}`);
    const isSource = locale === options.sourceLocale;
    const existing = new Map<string, CodecMessage>();
    if (pathExists(file)) {
      for (const message of codec.decode(fs.readFileSync(file, 'utf8'), {
        locale,
        sourceLocale: options.sourceLocale
      })) {
        existing.set(message.id, message);
      }
    }

    const merged = new Map<string, CodecMessage>();
    if (isSource) {
      for (const [id, message] of existing) merged.set(id, message);
    } else {
      for (const [id, message] of existing) if (sourceMessagesById.has(id)) merged.set(id, message);
    }
    for (const message of messages) {
      const text = isSource ? message.message : (message.translations[locale] ?? '');
      const previous = merged.get(message.id);
      if (!previous) {
        merged.set(message.id, {
          id: message.id,
          message: text,
          description: [],
          references: message.references
        });
        continue;
      }
      const seen = new Set(previous.references.map((ref) => `${ref.path}:${ref.line ?? ''}`));
      merged.set(message.id, {
        ...previous,
        message: isSource ? text : previous.message || text,
        references: [
          ...previous.references,
          ...message.references.filter((ref) => !seen.has(`${ref.path}:${ref.line}`))
        ]
      });
    }
    if (isSource) {
      for (const [id, message] of merged) sourceMessagesById.set(id, message);
    }

    fs.writeFileSync(file, codec.encode([...merged.values()], {locale, sourceMessagesById}));
  }
}
