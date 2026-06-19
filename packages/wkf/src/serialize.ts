import { stringify } from 'yaml';
import { FrontmatterSchema, type WkfDoc } from './types.js';

const FRONTMATTER_ORDER = [
  'type',
  'title',
  'description',
  'resource',
  'tags',
  'timestamp',
  'source_tier',
  'freshness',
  'last_verified',
  'status',
  'slug',
] as const;

function orderedFrontmatter(frontmatter: WkfDoc['frontmatter']): Record<string, unknown> {
  const parsed = FrontmatterSchema.parse(frontmatter);
  const result: Record<string, unknown> = {};
  const remaining = { ...parsed };

  for (const key of FRONTMATTER_ORDER) {
    if (remaining[key] !== undefined) {
      result[key] = remaining[key];
      delete remaining[key];
    }
  }

  for (const key of Object.keys(remaining).sort()) {
    result[key] = remaining[key];
  }

  return result;
}

export function serialize(doc: WkfDoc): string {
  const frontmatter = stringify(orderedFrontmatter(doc.frontmatter), {
    collectionStyle: 'flow',
    lineWidth: 0,
    sortMapEntries: false,
  }).trimEnd();
  const body = doc.body.replace(/^\r?\n/, '');
  return `---\n${frontmatter}\n---\n${body}`;
}
