import { isAbsolute, join } from 'node:path';

export function slugToBundlePath(bundlePath: string, slug: string): string {
  const clean = slug.replace(/^\/+/, '').replace(/\.md$/i, '').replaceAll('\\', '/');
  if (!clean || isAbsolute(clean) || /^[A-Za-z]:/.test(clean) || clean.split('/').includes('..')) {
    throw new Error(`Invalid WKF slug path: ${slug}`);
  }
  return join(bundlePath, `${clean}.md`);
}

export function slugFromDocument(doc: { slug?: unknown; title?: unknown }): string {
  if (typeof doc.slug === 'string' && doc.slug.trim()) return doc.slug.trim();
  const title = typeof doc.title === 'string' && doc.title.trim() ? doc.title : 'untitled';
  return title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}
