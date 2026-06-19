import { parseDocument } from 'yaml';
import { FrontmatterSchema, type WkfDoc } from './types.js';

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?/;

export function parse(markdown: string): WkfDoc {
  const match = FRONTMATTER_PATTERN.exec(markdown);
  if (!match) throw new Error('WKF document is missing YAML frontmatter');

  const yamlText = match[1] ?? '';
  const parsed = parseDocument(yamlText, { strict: true });
  if (parsed.errors.length > 0) {
    throw new Error(`Invalid WKF frontmatter: ${parsed.errors[0]!.message}`);
  }

  return {
    frontmatter: FrontmatterSchema.parse(parsed.toJSON()),
    body: markdown.slice(match[0].length),
  };
}
