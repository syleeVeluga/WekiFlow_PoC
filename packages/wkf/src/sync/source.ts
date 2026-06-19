import { readFile } from 'node:fs/promises';
import type { MongoWkfDocument } from '../types.js';

export interface WkfDocumentSource {
  listPublished(): Promise<MongoWkfDocument[]>;
}

export class JsonDocumentSource implements WkfDocumentSource {
  constructor(private readonly path: string) {}

  async listPublished(): Promise<MongoWkfDocument[]> {
    const raw = JSON.parse((await readFile(this.path, 'utf8')).replace(/^\uFEFF/, '')) as unknown;
    const docs = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && 'documents' in raw ? (raw.documents as unknown) : [];
    if (!Array.isArray(docs)) throw new Error('JSON source must be an array or { documents: [...] }');
    return docs.filter((doc): doc is MongoWkfDocument => Boolean(doc && typeof doc === 'object' && (doc as MongoWkfDocument).status === 'PUBLISHED'));
  }
}
