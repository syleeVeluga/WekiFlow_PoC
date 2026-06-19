import { createHash } from 'node:crypto';
import { parse } from '../parse.js';
import { serialize } from '../serialize.js';

export function rawContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function contentHash(markdown: string): string {
  return rawContentHash(serialize(parse(markdown)));
}
