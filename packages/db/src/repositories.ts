import { ObjectId, type Db, type Document, type WithId } from 'mongodb';
import {
  normalizeEntityName,
  type DocumentDTO,
  type DocumentStatus,
  type TreeNode,
  type Triplet,
} from '@wf/shared';

function toObjectId(id: string): ObjectId | null {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

function slugify(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'untitled'
  );
}

function makeDocumentSlug(title: string, id: ObjectId): string {
  return `${slugify(title)}-${id.toHexString().slice(-6)}`;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(0).toISOString();
}

export function toDocumentDTO(raw: WithId<Document>): DocumentDTO {
  return {
    id: raw._id.toString(),
    slug: String(raw.slug ?? ''),
    title: String(raw.title ?? 'Untitled'),
    parentId: raw.parentId ? String(raw.parentId) : null,
    isFolder: Boolean(raw.isFolder),
    status: (raw.status ?? 'DRAFT') as DocumentStatus,
    contentMarkdown: String(raw.contentMarkdown ?? ''),
    draftMarkdown: raw.draftMarkdown == null ? null : String(raw.draftMarkdown),
    version: typeof raw.version === 'number' ? raw.version : 1,
    sourceRefs: Array.isArray(raw.sourceRefs) ? raw.sourceRefs : [],
    createdBy: raw.createdBy ? String(raw.createdBy) : undefined,
    approvedBy: raw.approvedBy == null ? undefined : String(raw.approvedBy),
    createdAt: toIso(raw.createdAt),
    updatedAt: toIso(raw.updatedAt),
  };
}

export function createDocumentsRepo(db: Db) {
  const collection = db.collection('documents');

  return {
    async getById(id: string): Promise<DocumentDTO | undefined> {
      const oid = toObjectId(id);
      if (!oid) return undefined;
      const doc = await collection.findOne({ _id: oid });
      return doc ? toDocumentDTO(doc) : undefined;
    },

    async tree(): Promise<TreeNode[]> {
      const docs = await collection
        .find({}, { projection: { title: 1, slug: 1, parentId: 1, isFolder: 1, status: 1 } })
        .toArray();
      return docs.map((doc) => ({
        id: doc._id.toString(),
        parentId: doc.parentId ? String(doc.parentId) : null,
        title: String(doc.title ?? 'Untitled'),
        slug: String(doc.slug ?? ''),
        isFolder: Boolean(doc.isFolder),
        status: (doc.status ?? 'DRAFT') as DocumentStatus,
      }));
    },

    async reviews(): Promise<DocumentDTO[]> {
      const docs = await collection.find({ status: 'REVIEW' }).toArray();
      return docs.map(toDocumentDTO);
    },

    async createDraft(input: {
      title: string;
      contentMarkdown: string;
      parentId?: string | null;
    }): Promise<DocumentDTO> {
      const now = new Date();
      const id = new ObjectId();
      const result = await collection.insertOne({
        _id: id,
        slug: makeDocumentSlug(input.title, id),
        title: input.title,
        parentId: input.parentId ?? null,
        isFolder: false,
        status: 'PROCESSING',
        contentMarkdown: input.contentMarkdown,
        draftMarkdown: null,
        version: 1,
        sourceRefs: [{ type: 'manual', ref: 'api://ingest', note: '' }],
        createdAt: now,
        updatedAt: now,
      });
      const doc = await collection.findOne({ _id: result.insertedId });
      return toDocumentDTO(doc!);
    },

    async createDocument(input: {
      title: string;
      contentMarkdown?: string;
      parentId?: string | null;
      isFolder?: boolean;
    }): Promise<DocumentDTO> {
      const now = new Date();
      const id = new ObjectId();
      const result = await collection.insertOne({
        _id: id,
        slug: makeDocumentSlug(input.title, id),
        title: input.title,
        parentId: input.parentId ?? null,
        isFolder: input.isFolder ?? false,
        status: 'DRAFT',
        contentMarkdown: input.contentMarkdown ?? '',
        draftMarkdown: null,
        version: 1,
        sourceRefs: [],
        createdAt: now,
        updatedAt: now,
      });
      const doc = await collection.findOne({ _id: result.insertedId });
      return toDocumentDTO(doc!);
    },

    async setDraft(id: string, draftMarkdown: string) {
      const oid = toObjectId(id);
      if (!oid) return;
      await collection.updateOne(
        { _id: oid },
        {
          $set: {
            draftMarkdown,
            status: 'REVIEW',
            updatedAt: new Date(),
          },
        },
      );
    },

    async publish(id: string): Promise<DocumentDTO | undefined> {
      const oid = toObjectId(id);
      if (!oid) return undefined;
      const current = await collection.findOne({ _id: oid });
      if (!current) return undefined;
      const updated = await collection.findOneAndUpdate(
        { _id: oid },
        {
          $set: {
            contentMarkdown: current.draftMarkdown ?? current.contentMarkdown ?? '',
            draftMarkdown: null,
            status: 'PUBLISHED',
            updatedAt: new Date(),
          },
          $inc: { version: 1 },
        },
        { returnDocument: 'after' },
      );
      return updated ? toDocumentDTO(updated) : undefined;
    },

    async reject(id: string): Promise<DocumentDTO | undefined> {
      const oid = toObjectId(id);
      if (!oid) return undefined;
      const updated = await collection.findOneAndUpdate(
        { _id: oid },
        { $set: { status: 'DRAFT', draftMarkdown: null, updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
      return updated ? toDocumentDTO(updated) : undefined;
    },
  };
}

export function createJobsRepo(db: Db) {
  const collection = db.collection<{
    bullJobId: string;
    agentSteps?: Array<{ tool: string; args: unknown; result?: unknown; createdAt: Date }>;
  }>('jobs');

  return {
    async appendAgentStep(jobId: string, step: { tool: string; args: unknown; result?: unknown }) {
      await collection.updateOne(
        { bullJobId: jobId },
        {
          $setOnInsert: { createdAt: new Date() },
          $set: { updatedAt: new Date() },
          $push: { agentSteps: { ...step, createdAt: new Date() } },
        },
        { upsert: true },
      );
    },
  };
}

export function createSandboxRunsRepo(db: Db) {
  const collection = db.collection('sandbox_runs');

  return {
    async record(run: {
      jobId: string;
      image: string;
      command: string[];
      stdout: string;
      stderr: string;
      exitCode: number;
      durationMs: number;
      mounts: Array<{ source: string; target: string; ro: boolean }>;
    }) {
      await collection.insertOne({ ...run, createdAt: new Date() });
    },
  };
}

export async function upsertTriplets(db: Db, triplets: Triplet[], sourceDocId: string): Promise<void> {
  for (const triplet of triplets) {
    const subject = await db.collection('kg_nodes').findOneAndUpdate(
      { normalizedName: normalizeEntityName(triplet.subject) },
      {
        $setOnInsert: {
          name: triplet.subject,
          normalizedName: normalizeEntityName(triplet.subject),
          type: triplet.subjectType,
          createdAt: new Date(),
        },
        $set: { updatedAt: new Date() },
        $addToSet: {
          aliases: triplet.subject,
          descriptions: { text: triplet.subject, sourceDocId },
        },
      },
      { upsert: true, returnDocument: 'after' },
    );

    const object = await db.collection('kg_nodes').findOneAndUpdate(
      { normalizedName: normalizeEntityName(triplet.object) },
      {
        $setOnInsert: {
          name: triplet.object,
          normalizedName: normalizeEntityName(triplet.object),
          type: triplet.objectType,
          createdAt: new Date(),
        },
        $set: { updatedAt: new Date() },
        $addToSet: {
          aliases: triplet.object,
          descriptions: { text: triplet.object, sourceDocId },
        },
      },
      { upsert: true, returnDocument: 'after' },
    );

    await db.collection('kg_edges').updateOne(
      {
        subjectId: subject?._id,
        predicate: triplet.predicate,
        objectId: object?._id,
      },
      {
        $setOnInsert: { createdAt: new Date() },
        $set: { updatedAt: new Date() },
        $max: { strength: triplet.strength },
        $addToSet: {
          sourceDocIds: sourceDocId,
          descriptions: {
            text: `${triplet.subject} ${triplet.predicate} ${triplet.object}`,
            sourceDocId,
          },
        },
      },
      { upsert: true },
    );
  }
}
