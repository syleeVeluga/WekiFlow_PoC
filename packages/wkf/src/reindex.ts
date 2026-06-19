import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { chunkMarkdown, normalizeEntityName, type EmbedFn } from '@wf/shared';
import { ObjectId, type Db, type Document } from 'mongodb';
import { parse } from './parse.js';
import { parseRelations } from './sections.js';
import { slugToBundlePath } from './sync/paths.js';

const RESERVED_MARKDOWN = new Set(['index.md', 'log.md']);

export interface ReindexOptions {
  all?: boolean;
  concept?: string;
  embeddingModel?: string;
  embed?: EmbedFn;
}

export interface ReindexedConcept {
  slug: string;
  documentId: string;
  chunkCount: number;
  relationCount: number;
}

export interface ReindexResult {
  concepts: ReindexedConcept[];
  chunkCount: number;
  relationCount: number;
}

function slugFromPath(bundlePath: string, path: string): string {
  return relative(bundlePath, path).split(sep).join('/').replace(/\.md$/i, '');
}

function documentIdForSlug(slug: string): ObjectId {
  return new ObjectId(createHash('sha1').update(slug).digest('hex').slice(0, 24));
}

function nodeIdForName(name: string): ObjectId {
  return new ObjectId(createHash('sha1').update(normalizeEntityName(name)).digest('hex').slice(0, 24));
}

function sourceSignature(embeddingModel: string, markdown: string): string {
  return createHash('sha256').update(`${embeddingModel}\n${markdown}`).digest('hex');
}

async function listConceptFiles(bundlePath: string, dir = bundlePath): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === '.wkf' || entry.name === 'references') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listConceptFiles(bundlePath, path)));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.md') || RESERVED_MARKDOWN.has(entry.name)) continue;
    files.push(path);
  }
  return files.sort((a, b) => slugFromPath(bundlePath, a).localeCompare(slugFromPath(bundlePath, b)));
}

export async function defaultDeterministicEmbed(texts: string[]): Promise<number[][]> {
  return texts.map((text) => {
    const hash = createHash('sha256').update(text).digest();
    return Array.from({ length: 16 }, (_, index) => hash[index]! / 255);
  });
}

async function upsertNode(db: Db, name: string, sourceDocId: ObjectId): Promise<Document> {
  const normalizedName = normalizeEntityName(name);
  const updated = await db.collection('kg_nodes').findOneAndUpdate(
    { normalizedName },
    {
      $setOnInsert: {
        _id: nodeIdForName(name),
        name,
        normalizedName,
        type: 'ENTITY',
        createdAt: new Date(0),
      },
      $set: { updatedAt: new Date(0) },
      $addToSet: {
        aliases: name,
        descriptions: { text: name, sourceDocId },
      },
    },
    { upsert: true, returnDocument: 'after' },
  );
  if (!updated) throw new Error(`Failed to upsert KG node: ${name}`);
  return updated;
}

async function cleanupOrphanNodes(db: Db): Promise<void> {
  const edges = db.collection('kg_edges');
  const usedIds = new Set<string>();
  for (const id of await edges.distinct('subjectId')) {
    if (id instanceof ObjectId) usedIds.add(id.toHexString());
  }
  for (const id of await edges.distinct('objectId')) {
    if (id instanceof ObjectId) usedIds.add(id.toHexString());
  }
  const keep = [...usedIds].map((id) => new ObjectId(id));
  if (keep.length === 0) {
    await db.collection('kg_nodes').deleteMany({});
    return;
  }
  await db.collection('kg_nodes').deleteMany({ _id: { $nin: keep } });
}

async function removeConceptDerivedRows(db: Db, documentId: ObjectId, cleanupOrphans: boolean): Promise<void> {
  await db.collection('chunks').deleteMany({ documentId });
  await db.collection('kg_edges').updateMany({ sourceDocIds: documentId }, { $pull: { sourceDocIds: documentId } } as Document);
  await db.collection('kg_edges').deleteMany({ $or: [{ sourceDocIds: { $size: 0 } }, { sourceDocIds: { $exists: false } }] });
  if (cleanupOrphans) await cleanupOrphanNodes(db);
}

async function reindexConcept(
  db: Db,
  path: string,
  slug: string,
  options: Required<Pick<ReindexOptions, 'embeddingModel' | 'embed'>> & { cleanupOrphans: boolean },
): Promise<ReindexedConcept> {
  const raw = await readFile(path, 'utf8');
  const doc = parse(raw);
  const documentId = documentIdForSlug(doc.frontmatter.slug ?? slug);
  const markdownForChunks = doc.body.trim();
  const chunks = chunkMarkdown(markdownForChunks);
  const embeddings = chunks.length > 0 ? await options.embed(chunks.map((chunk) => chunk.text)) : [];
  const now = new Date(0);

  await removeConceptDerivedRows(db, documentId, options.cleanupOrphans);
  if (chunks.length > 0) {
    await db.collection('chunks').insertMany(
      chunks.map((chunk, index) => ({
        documentId,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        tokens: chunk.tokens,
        headingPath: chunk.headingPath,
        embedding: embeddings[index] ?? [],
        embeddingModel: options.embeddingModel,
        sourceHash: sourceSignature(options.embeddingModel, raw),
        sourceSlug: slug,
        createdAt: now,
      })),
    );
  }

  const relations = parseRelations(doc.body);
  for (const relation of relations) {
    const subject = await upsertNode(db, relation.subject, documentId);
    const object = await upsertNode(db, relation.object, documentId);
    await db.collection('kg_edges').updateOne(
      {
        subjectId: subject._id,
        predicate: relation.predicate,
        objectId: object._id,
      },
      {
        $setOnInsert: { createdAt: now },
        $set: {
          updatedAt: now,
          ...(relation.ref ? { ref: relation.ref } : {}),
        },
        $max: { strength: relation.strength ?? 1 },
        $addToSet: {
          sourceDocIds: documentId,
          descriptions: {
            text: `${relation.subject} ${relation.predicate} ${relation.object}`,
            sourceDocId: documentId,
          },
        },
      },
      { upsert: true },
    );
  }

  return {
    slug,
    documentId: documentId.toHexString(),
    chunkCount: chunks.length,
    relationCount: relations.length,
  };
}

export async function reindexBundle(db: Db, bundlePath: string, options: ReindexOptions = {}): Promise<ReindexResult> {
  if (!options.all && !options.concept) throw new Error('wkf reindex requires --all or --concept <slug>');
  if (options.all && options.concept) throw new Error('wkf reindex accepts either --all or --concept, not both');

  const embed = options.embed ?? defaultDeterministicEmbed;
  const embeddingModel = options.embeddingModel ?? 'wkf-deterministic-test-embedding';

  if (options.all) {
    await Promise.all([
      db.collection('chunks').deleteMany({}),
      db.collection('kg_edges').deleteMany({}),
      db.collection('kg_nodes').deleteMany({}),
    ]);
  }

  const files = options.concept
    ? [slugToBundlePath(bundlePath, options.concept)]
    : await listConceptFiles(bundlePath);

  const concepts: ReindexedConcept[] = [];
  for (const file of files) {
    concepts.push(await reindexConcept(db, file, slugFromPath(bundlePath, file), { embed, embeddingModel, cleanupOrphans: !options.all }));
  }

  return {
    concepts,
    chunkCount: concepts.reduce((sum, concept) => sum + concept.chunkCount, 0),
    relationCount: concepts.reduce((sum, concept) => sum + concept.relationCount, 0),
  };
}
