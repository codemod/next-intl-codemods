import {TYPE, parse} from '@formatjs/icu-messageformat-parser';
import type {MessageFormatElement} from '@formatjs/icu-messageformat-parser';

/**
 * Argument and tag names an ICU message declares.
 * Uses the FormatJS parser so escaped literals like `'{name}'` are not treated as placeholders.
 */
export function icuNames(message: string): {args: Set<string>; tags: Set<string>} {
  const args = new Set<string>();
  const tags = new Set<string>();

  function walk(elements: MessageFormatElement[]) {
    for (const el of elements) {
      switch (el.type) {
        case TYPE.argument:
        case TYPE.number:
        case TYPE.date:
        case TYPE.time:
        case TYPE.select:
        case TYPE.plural:
          args.add(el.value);
          if (el.type === TYPE.select || el.type === TYPE.plural) {
            for (const option of Object.values(el.options)) {
              walk(option.value);
            }
          }
          break;
        case TYPE.tag:
          tags.add(el.value);
          walk(el.children);
          break;
        default:
          break;
      }
    }
  }

  try {
    walk(parse(message, {ignoreTag: false}));
  } catch {
    // Malformed messages: fall back to empty sets (safer than false positives).
  }
  return {args, tags};
}
