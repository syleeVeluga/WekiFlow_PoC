import { serialize } from './serialize.js';
import { WkfDocumentStatusSchema, type MongoWkfDocument, type WkfDoc } from './types.js';

function sourceRefsToCitationLines(sourceRefs: unknown, startIndex: number): string[] {
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) return [];
  return sourceRefs.map((sourceRef, index) => {
    const ref = sourceRef && typeof sourceRef === 'object' && 'ref' in sourceRef ? String(sourceRef.ref) : String(sourceRef);
    const note = sourceRef && typeof sourceRef === 'object' && 'note' in sourceRef ? ` - ${String(sourceRef.note)}` : '';
    const citationNumber = startIndex + index + 1;
    return `${citationNumber}. [Source ${citationNumber}](${ref})${note}`;
  });
}

function appendSourceRefs(body: string, sourceRefs: unknown): string {
  const existingCitationCount = body.match(/^\s*\d+\.\s+/gm)?.length ?? 0;
  const lines = sourceRefsToCitationLines(sourceRefs, existingCitationCount);
  if (lines.length === 0) return body;
  const trimmed = body.trimEnd();
  const prefix = /^#\s+Citations\s*$/im.test(trimmed) ? '\n' : '\n\n# Citations\n';
  return `${trimmed}${prefix}${lines.join('\n')}\n`;
}

export function fromMongo(doc: MongoWkfDocument): WkfDoc {
  const title = typeof doc.title === 'string' && doc.title.trim() ? doc.title : 'Untitled';
  const slug = typeof doc.slug === 'string' && doc.slug.trim() ? doc.slug : undefined;
  const status = WkfDocumentStatusSchema.safeParse(doc.status).success ? WkfDocumentStatusSchema.parse(doc.status) : undefined;
  const body = appendSourceRefs(typeof doc.contentMarkdown === 'string' ? doc.contentMarkdown : '', doc.sourceRefs);

  return {
    frontmatter: {
      type: 'ENTITY',
      title,
      tags: [],
      ...(slug ? { slug, resource: `wekiflow://${slug}` } : {}),
      ...(status ? { status } : {}),
    },
    body,
  };
}

export function fromMongoMarkdown(doc: MongoWkfDocument): string {
  return serialize(fromMongo(doc));
}
