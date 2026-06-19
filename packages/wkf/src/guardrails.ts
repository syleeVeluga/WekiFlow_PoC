import { extractHeadings, extractSection, parseCitations } from './sections.js';
import type { Frontmatter, WkfDoc } from './types.js';

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly rule: string,
    public readonly location?: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

function normalizeHeading(heading: string): string {
  return heading.trim().replace(/\s+/g, ' ');
}

export function schemaFieldCount(body: string): number {
  const schema = extractSection(body, 'Schema') ?? '';
  return schema.split(/\r?\n/).filter((line) => /^\s*-\s+`?[\w.-]+`?/.test(line)).length;
}

export function citationCount(doc: WkfDoc): number {
  return parseCitations(doc.body).length;
}

export function assertHeadingsPreserved(beforeBody: string, afterBody: string): void {
  const before = extractHeadings(beforeBody).map(normalizeHeading);
  const after = extractHeadings(afterBody).map(normalizeHeading);
  let cursor = 0;

  for (const heading of before) {
    const found = after.indexOf(heading, cursor);
    if (found === -1) {
      throw new ValidationError(`Missing preserved heading: ${heading}`, 'headings-preserved');
    }
    cursor = found + 1;
  }
}

export function assertFrontmatterPreserved(before: Frontmatter, after: Frontmatter): void {
  if (after.type !== before.type) throw new ValidationError('frontmatter.type changed', 'frontmatter-preserved', 'type');
  if (before.resource !== undefined && after.resource !== before.resource) {
    throw new ValidationError('frontmatter.resource changed', 'frontmatter-preserved', 'resource');
  }

  const afterTags = new Set(after.tags);
  for (const tag of before.tags) {
    if (!afterTags.has(tag)) throw new ValidationError(`frontmatter.tags dropped ${tag}`, 'frontmatter-preserved', 'tags');
  }
}

export function assertNoShrinkage(before: WkfDoc, after: WkfDoc): void {
  assertHeadingsPreserved(before.body, after.body);

  const beforeSchemaFields = schemaFieldCount(before.body);
  const afterSchemaFields = schemaFieldCount(after.body);
  if (afterSchemaFields < beforeSchemaFields) {
    throw new ValidationError('schema field count decreased', 'schema-nonshrinkage', 'Schema');
  }

  if (citationCount(after) < citationCount(before)) {
    throw new ValidationError('citation count decreased', 'citation-nonshrinkage', 'Citations');
  }

  assertFrontmatterPreserved(before.frontmatter, after.frontmatter);
}
