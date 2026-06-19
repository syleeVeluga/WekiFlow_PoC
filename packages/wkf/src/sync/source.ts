import { readFile, writeFile } from 'node:fs/promises';
import type { MongoWkfDocument } from '../types.js';

export interface WkfDocumentSource {
  listPublished(): Promise<MongoWkfDocument[]>;
}

export interface WkfDocumentStore extends WkfDocumentSource {
  getBySlug(slug: string): Promise<MongoWkfDocument | undefined>;
  upsert(doc: MongoWkfDocument): Promise<void>;
}

function parseJsonDocuments(rawText: string): MongoWkfDocument[] {
  const raw = JSON.parse(rawText.replace(/^\uFEFF/, '')) as unknown;
  const docs = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && 'documents' in raw ? (raw.documents as unknown) : [];
  if (!Array.isArray(docs)) throw new Error('JSON source must be an array or { documents: [...] }');
  return docs.filter((doc): doc is MongoWkfDocument => Boolean(doc && typeof doc === 'object'));
}

export class JsonDocumentSource implements WkfDocumentSource {
  constructor(protected readonly path: string) {}

  async listPublished(): Promise<MongoWkfDocument[]> {
    return parseJsonDocuments(await readFile(this.path, 'utf8')).filter((doc) => doc.status === 'PUBLISHED');
  }
}

export class JsonDocumentStore extends JsonDocumentSource implements WkfDocumentStore {
  async getBySlug(slug: string): Promise<MongoWkfDocument | undefined> {
    return parseJsonDocuments(await readFile(this.path, 'utf8')).find((doc) => doc.slug === slug);
  }

  async upsert(doc: MongoWkfDocument): Promise<void> {
    const docs = parseJsonDocuments(await readFile(this.path, 'utf8'));
    const index = docs.findIndex((candidate) => candidate.slug === doc.slug);
    if (index === -1) docs.push(doc);
    else docs[index] = { ...docs[index], ...doc };
    await writeFile(this.path, `${JSON.stringify({ documents: docs }, null, 2)}\n`, 'utf8');
  }
}
