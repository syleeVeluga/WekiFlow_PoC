import { ObjectId, type Db, type Document, type WithId } from 'mongodb';
import { createHash, randomUUID } from 'node:crypto';
import {
  buildIngestedKnowledgeItem,
  buildIngestionIdempotencyScope,
  chunkMarkdown,
  AppSettingsSchema,
  DEFAULT_APP_SETTINGS,
  ingestSourceNote,
  normalizeEntityName,
  type AgentStepDTO,
  type AppSettings,
  type ConnectionFact,
  type DocumentConnections,
  type DocumentDTO,
  type DocumentStatus,
  type EmbedFn,
  type IngestionInfo,
  type UpdateAppSettings,
  type KnowledgeItem,
  type RelatedDoc,
  type SourceRef,
  type TreeNode,
  type Triplet,
  type User,
  type UserRole,
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

function toIngestionInfo(value: unknown): IngestionInfo | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const info: IngestionInfo = {};
  if (typeof raw.workspaceId === 'string') info.workspaceId = raw.workspaceId;
  if (typeof raw.sourceName === 'string') info.sourceName = raw.sourceName;
  if (typeof raw.idempotencyKey === 'string') info.idempotencyKey = raw.idempotencyKey;
  if (typeof raw.idempotencyScope === 'string') info.idempotencyScope = raw.idempotencyScope;
  if (typeof raw.contentType === 'string') info.contentType = raw.contentType;
  if (typeof raw.sourceLabel === 'string') info.sourceLabel = raw.sourceLabel;
  if (raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)) {
    info.metadata = raw.metadata as Record<string, unknown>;
  }
  if (typeof raw.jobId === 'string') info.jobId = raw.jobId;
  if (raw.receivedAt != null) info.receivedAt = toIso(raw.receivedAt);
  return Object.keys(info).length > 0 ? info : undefined;
}

export function toDocumentDTO(raw: WithId<Document>): DocumentDTO {
  const ingestion = toIngestionInfo(raw.ingestion);
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
    ...(ingestion ? { ingestion } : {}),
    createdBy: raw.createdBy ? String(raw.createdBy) : undefined,
    approvedBy: raw.approvedBy == null ? undefined : String(raw.approvedBy),
    createdAt: toIso(raw.createdAt),
    updatedAt: toIso(raw.updatedAt),
  };
}

export function createDocumentsRepo(db: Db) {
  const collection = db.collection('documents');
  const chunks = db.collection('chunks');

  return {
    async getById(id: string): Promise<DocumentDTO | undefined> {
      const oid = toObjectId(id);
      if (!oid) return undefined;
      const doc = await collection.findOne({ _id: oid });
      return doc ? toDocumentDTO(doc) : undefined;
    },

    async tree(): Promise<TreeNode[]> {
      const docs = await collection
        .find({ preview: { $ne: true }, trashed: { $ne: true } }, { projection: { title: 1, slug: 1, parentId: 1, isFolder: 1, status: 1 } })
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
      const docs = await collection.find({ status: 'REVIEW', preview: { $ne: true }, trashed: { $ne: true } }).toArray();
      return docs.map(toDocumentDTO);
    },

    async createDraft(input: {
      title: string;
      contentMarkdown: string;
      slug?: string;
      parentId?: string | null;
      topic?: string;
      workspace?: string;
      sourceLabel?: string;
      sourceName?: string;
      idempotencyKey?: string;
      contentType?: string;
      sourceType?: SourceRef['type'];
      sourceRef?: string;
      ingestion?: IngestionInfo;
    }): Promise<DocumentDTO> {
      const now = new Date();
      const id = new ObjectId();
      const idempotencyScope = buildIngestionIdempotencyScope(input.ingestion ?? {});
      const ingestion = input.ingestion
        ? {
            ...input.ingestion,
            ...(idempotencyScope ? { idempotencyScope } : {}),
            receivedAt: now,
          }
        : undefined;
      const result = await collection.insertOne({
        _id: id,
        slug: input.slug ?? makeDocumentSlug(input.title, id),
        title: input.title,
        parentId: input.parentId ?? null,
        isFolder: false,
        status: 'PROCESSING',
        contentMarkdown: input.contentMarkdown,
        draftMarkdown: null,
        version: 1,
        // Persist the assigned topic/workspace as first-class fields (not just the sourceRefs note)
        // so publish() can materialize a wiki KnowledgeItem under the right category/department.
        ...(input.topic ? { topic: input.topic } : {}),
        ...(input.workspace ? { workspace: input.workspace } : {}),
        ...(input.sourceLabel ? { sourceLabel: input.sourceLabel } : {}),
        ...(input.sourceName ? { sourceName: input.sourceName } : {}),
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        ...(input.contentType ? { contentType: input.contentType } : {}),
        ...(ingestion ? { ingestion } : {}),
        sourceRefs: [{ type: input.sourceType ?? 'manual', ref: input.sourceRef ?? 'api://ingest', note: ingestSourceNote(input) }],
        createdAt: now,
        updatedAt: now,
      });
      const doc = await collection.findOne({ _id: result.insertedId });
      return toDocumentDTO(doc!);
    },

    async findByIngestionKey(input: {
      userId: string;
      workspaceId: string;
      sourceName: string;
      idempotencyKey: string;
    }): Promise<DocumentDTO | undefined> {
      const idempotencyScope = buildIngestionIdempotencyScope(input);
      if (!idempotencyScope) return undefined;
      const doc = await collection.findOne({ 'ingestion.idempotencyScope': idempotencyScope });
      return doc ? toDocumentDTO(doc) : undefined;
    },

    async setIngestionJobId(id: string, jobId: string): Promise<DocumentDTO | undefined> {
      const oid = toObjectId(id);
      if (!oid) return undefined;
      const updated = await collection.findOneAndUpdate(
        { _id: oid },
        { $set: { 'ingestion.jobId': jobId, updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
      return updated ? toDocumentDTO(updated) : undefined;
    },

    async createPreviewDraft(input: {
      title: string;
      contentMarkdown: string;
    }): Promise<DocumentDTO> {
      const now = new Date();
      const id = new ObjectId();
      const result = await collection.insertOne({
        _id: id,
        slug: makeDocumentSlug(input.title, id),
        title: input.title,
        parentId: null,
        isFolder: false,
        status: 'PREVIEW',
        preview: true,
        contentMarkdown: input.contentMarkdown,
        draftMarkdown: null,
        version: 1,
        sourceRefs: [{ type: 'manual', ref: 'api://agent-preview', note: '' }],
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

    async setDraftBySlug(slug: string, draftMarkdown: string): Promise<DocumentDTO | undefined> {
      const updated = await collection.findOneAndUpdate(
        { slug, preview: { $ne: true }, trashed: { $ne: true } },
        {
          $set: {
            draftMarkdown,
            status: 'REVIEW',
            updatedAt: new Date(),
          },
        },
        { returnDocument: 'after' },
      );
      return updated ? toDocumentDTO(updated) : undefined;
    },

    async setPreviewDraft(id: string, draftMarkdown: string) {
      const oid = toObjectId(id);
      if (!oid) return;
      await collection.updateOne(
        { _id: oid, preview: true },
        {
          $set: {
            draftMarkdown,
            status: 'PREVIEW',
            updatedAt: new Date(),
          },
        },
      );
    },

    async deletePreviewArtifacts(documentId: string): Promise<void> {
      const oid = toObjectId(documentId);
      if (!oid) return;
      await Promise.all([
        collection.deleteOne({ _id: oid, preview: true }),
        chunks.deleteMany({ documentId: oid }),
      ]);
    },

    async publish(id: string): Promise<DocumentDTO | undefined> {
      const oid = toObjectId(id);
      if (!oid) return undefined;
      const current = await collection.findOne({ _id: oid });
      if (!current) return undefined;
      const publishedContent = current.draftMarkdown ?? current.contentMarkdown ?? '';
      // Materialize (or refresh) the wiki KnowledgeItem so the published doc surfaces in the Document
      // Tree / KB under its assigned topic. wiki.id mirrors the document _id so getKnowledge/
      // patchKnowledge/documentByWikiId all resolve by the same key.
      const wiki = buildIngestedKnowledgeItem({
        id: oid.toString(),
        title: String(current.title ?? 'Untitled'),
        contentMarkdown: publishedContent,
        ...(typeof current.topic === 'string' ? { category: current.topic } : {}),
        ...(typeof current.workspace === 'string' ? { workspace: current.workspace } : {}),
        ...(typeof current.sourceLabel === 'string' ? { sourceLabel: current.sourceLabel } : {}),
        existing: (current.wiki as KnowledgeItem | undefined) ?? null,
      });
      const updated = await collection.findOneAndUpdate(
        { _id: oid },
        {
          $set: {
            contentMarkdown: publishedContent,
            draftMarkdown: null,
            status: 'PUBLISHED',
            wiki,
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

    async markGraphIndexed(id: string): Promise<DocumentDTO | undefined> {
      const oid = toObjectId(id);
      if (!oid) return undefined;
      const updated = await collection.findOneAndUpdate(
        { _id: oid },
        { $set: { status: 'GRAPH_INDEXED', updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
      return updated ? toDocumentDTO(updated) : undefined;
    },

    /** Existing tag vocabulary (document aiTags + topic names), deduped — used to bias AI tag reuse. */
    async listKnownTags(): Promise<string[]> {
      const [aiTags, topicNames] = await Promise.all([
        collection.distinct('wiki.aiTags', { trashed: { $ne: true } }) as Promise<string[]>,
        db.collection('topics').distinct('name', { isUnclassified: { $ne: true } }) as Promise<string[]>,
      ]);
      const seen = new Set<string>();
      const out: string[] = [];
      for (const tag of [...aiTags, ...topicNames]) {
        const trimmed = typeof tag === 'string' ? tag.trim() : '';
        if (trimmed && !seen.has(trimmed)) {
          seen.add(trimmed);
          out.push(trimmed);
        }
      }
      return out;
    },

    /** Union new AI tags into wiki.aiTags, preserving existing/manually-curated tags. */
    async addWikiTags(id: string, tags: string[]): Promise<void> {
      const oid = toObjectId(id);
      if (!oid) return;
      const cleaned = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
      if (cleaned.length === 0) return;
      await collection.updateOne(
        { _id: oid },
        { $addToSet: { 'wiki.aiTags': { $each: cleaned } }, $set: { updatedAt: new Date() } },
      );
    },

    /** Soft-delete: hide the document from the tree/KB and move it to the trash. */
    async trash(id: string): Promise<DocumentDTO | undefined> {
      const oid = toObjectId(id);
      if (!oid) return undefined;
      const updated = await collection.findOneAndUpdate(
        { _id: oid },
        { $set: { trashed: true, trashedAt: new Date(), updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
      return updated ? toDocumentDTO(updated) : undefined;
    },

    /** Restore a trashed document back into the tree/KB. */
    async restore(id: string): Promise<DocumentDTO | undefined> {
      const oid = toObjectId(id);
      if (!oid) return undefined;
      const updated = await collection.findOneAndUpdate(
        { _id: oid },
        { $set: { trashed: false, updatedAt: new Date() }, $unset: { trashedAt: '' } },
        { returnDocument: 'after' },
      );
      return updated ? toDocumentDTO(updated) : undefined;
    },

    /** Trashed documents, newest first. */
    async listTrashed(): Promise<Array<{ id: string; title: string; category?: string; trashedAt: string }>> {
      const docs = await collection
        .find({ trashed: true }, { projection: { title: 1, wiki: 1, trashedAt: 1 } })
        .sort({ trashedAt: -1 })
        .toArray();
      return docs.map((doc) => {
        const category = (doc.wiki as KnowledgeItem | undefined)?.category;
        return {
          id: doc._id.toString(),
          title: String((doc.wiki as KnowledgeItem | undefined)?.title ?? doc.title ?? 'Untitled'),
          ...(category ? { category } : {}),
          trashedAt: toIso(doc.trashedAt),
        };
      });
    },

    /**
     * Permanent delete (cascade): remove the document, its chunks, and drop this doc from every
     * knowledge-graph edge's sourceDocIds — deleting edges that no longer back any source.
     */
    async purge(id: string): Promise<boolean> {
      const oid = toObjectId(id);
      if (!oid) return false;
      const result = await collection.deleteOne({ _id: oid, trashed: true });
      if (result.deletedCount === 0) return false;

      const edges = db.collection('kg_edges');
      await Promise.all([
        chunks.deleteMany({ documentId: oid }),
        edges.updateMany({ sourceDocIds: oid }, { $pull: { sourceDocIds: oid } } as Document),
      ]);
      await edges.deleteMany({ $or: [{ sourceDocIds: { $size: 0 } }, { sourceDocIds: { $exists: false } }] });
      return true;
    },
  };
}

function toUserDTO(raw: WithId<Document>): User {
  return {
    id: raw._id.toString(),
    email: String(raw.email ?? ''),
    name: String(raw.name ?? ''),
    role: (raw.role ?? 'VIEWER') as UserRole,
    createdAt: toIso(raw.createdAt),
  };
}

/**
 * Users + opaque session tokens (PoC auth). Mirrors {@link createDocumentsRepo}.
 * Passwords are stored in plaintext for the PoC and never returned in DTOs.
 */
export function createUsersRepo(db: Db) {
  const users = db.collection('users');
  const sessions = db.collection('sessions');

  return {
    /** Idempotently ensure the seeded owner exists (boot-time). */
    async ensureOwner(email: string, password: string): Promise<void> {
      const now = new Date();
      await users.updateOne(
        { email },
        { $setOnInsert: { email, name: '소유자', role: 'OWNER', password, createdAt: now } },
        { upsert: true },
      );
    },

    async list(): Promise<User[]> {
      const rows = await users.find({}, { projection: { password: 0 } }).sort({ createdAt: 1 }).toArray();
      return rows.map(toUserDTO);
    },

    async getById(id: string): Promise<User | undefined> {
      const oid = toObjectId(id);
      if (!oid) return undefined;
      const row = await users.findOne({ _id: oid }, { projection: { password: 0 } });
      return row ? toUserDTO(row) : undefined;
    },

    /** Returns the raw record including password — login use only. */
    async findByEmailWithPassword(email: string): Promise<(User & { password: string }) | undefined> {
      const row = await users.findOne({ email });
      return row ? { ...toUserDTO(row), password: String(row.password ?? '') } : undefined;
    },

    async create(input: { email: string; name: string; role: UserRole; password: string }): Promise<User> {
      const now = new Date();
      const id = new ObjectId();
      await users.insertOne({ _id: id, ...input, createdAt: now });
      return { id: id.toString(), email: input.email, name: input.name, role: input.role, createdAt: now.toISOString() };
    },

    async updateRole(id: string, role: UserRole): Promise<User | undefined> {
      const oid = toObjectId(id);
      if (!oid) return undefined;
      const updated = await users.findOneAndUpdate(
        { _id: oid },
        { $set: { role } },
        { returnDocument: 'after', projection: { password: 0 } },
      );
      return updated ? toUserDTO(updated) : undefined;
    },

    async remove(id: string): Promise<void> {
      const oid = toObjectId(id);
      if (!oid) return;
      await users.deleteOne({ _id: oid });
      await sessions.deleteMany({ userId: id });
    },

    async countByRole(role: UserRole): Promise<number> {
      return users.countDocuments({ role });
    },

    async createSession(userId: string): Promise<string> {
      const token = randomUUID();
      await sessions.insertOne({ token, userId, createdAt: new Date() });
      return token;
    },

    /** Resolve a session token to its user id (or undefined if unknown). */
    async resolveSession(token: string): Promise<string | undefined> {
      const row = await sessions.findOne({ token });
      return row ? String(row.userId) : undefined;
    },

    async deleteSession(token: string): Promise<void> {
      await sessions.deleteOne({ token });
    },
  };
}

export function createSettingsRepo(db: Db) {
  const collection = db.collection<{
    _id: string;
    reviewApprovalEnabled?: boolean;
    createdAt?: Date;
    updatedAt?: Date;
  }>('app_settings');
  const id = 'global';

  return {
    async get(): Promise<AppSettings> {
      const row = await collection.findOne({ _id: id });
      return AppSettingsSchema.parse({ ...DEFAULT_APP_SETTINGS, ...(row ?? {}) });
    },

    async update(patch: UpdateAppSettings): Promise<AppSettings> {
      const set: { reviewApprovalEnabled?: boolean; updatedAt: Date } = { updatedAt: new Date() };
      if (patch.reviewApprovalEnabled !== undefined) set.reviewApprovalEnabled = patch.reviewApprovalEnabled;
      await collection.updateOne(
        { _id: id },
        {
          $setOnInsert: { createdAt: new Date() },
          $set: set,
        },
        { upsert: true },
      );
      return this.get();
    },
  };
}

export interface ChunkRecord {
  chunkIndex: number;
  text: string;
  tokens: number;
  headingPath: string[];
  embedding: number[];
  embeddingModel: string;
}

export interface ChunkSearchRow {
  documentId: string;
  text: string;
  headingPath: string[];
  embedding: number[];
}

export function createChunksRepo(db: Db) {
  const collection = db.collection('chunks');

  return {
    /** Idempotently re-index a document: drop its existing chunks, then insert the new set. */
    async replaceForDocument(
      documentId: string,
      chunks: ChunkRecord[],
      signature?: string,
    ): Promise<void> {
      const oid = toObjectId(documentId);
      if (!oid) return;
      await collection.deleteMany({ documentId: oid });
      if (chunks.length === 0) return;
      const now = new Date();
      await collection.insertMany(
        chunks.map((chunk) => ({ ...chunk, documentId: oid, sourceHash: signature ?? null, createdAt: now })),
      );
    },

    /** Signature stored alongside a document's chunks, used to skip re-embedding unchanged content. */
    async getSignature(documentId: string): Promise<string | null> {
      const oid = toObjectId(documentId);
      if (!oid) return null;
      const row = await collection.findOne({ documentId: oid }, { projection: { sourceHash: 1 } });
      return row && typeof row.sourceHash === 'string' ? row.sourceHash : null;
    },

    /** Load embeddings for application-layer cosine search (VECTOR_SEARCH_MODE=app-cosine). */
    async listForSearch(documentId?: string): Promise<ChunkSearchRow[]> {
      const filter = documentId && toObjectId(documentId) ? { documentId: toObjectId(documentId)! } : {};
      const rows = await collection
        .find(filter, { projection: { text: 1, documentId: 1, headingPath: 1, embedding: 1 } })
        .toArray();
      return rows
        .filter((row) => Array.isArray(row.embedding))
        .map((row) => ({
          documentId: String(row.documentId),
          text: String(row.text ?? ''),
          headingPath: Array.isArray(row.headingPath) ? (row.headingPath as string[]) : [],
          embedding: row.embedding as number[],
        }));
    },
  };
}

/**
 * Chunk + embed approved document content into `chunks` for vector retrieval.
 * Reuses a content/model signature to avoid repeat embedding calls for unchanged text.
 */
export async function indexDocumentChunks(
  db: Db,
  embed: EmbedFn,
  documentId: string,
  markdown: string,
  embeddingModel: string,
): Promise<number> {
  const chunks = chunkMarkdown(markdown);
  if (chunks.length === 0) return 0;
  const repo = createChunksRepo(db);
  const signature = createHash('sha256').update(`${embeddingModel}\n${markdown}`).digest('hex');
  if ((await repo.getSignature(documentId)) === signature) return chunks.length;
  const embeddings = await embed(chunks.map((chunk) => chunk.text));
  await repo.replaceForDocument(
    documentId,
    chunks.map((chunk, index) => ({
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
      tokens: chunk.tokens,
      headingPath: chunk.headingPath,
      embedding: embeddings[index] ?? [],
      embeddingModel,
    })),
    signature,
  );
  return chunks.length;
}

export interface GraphNodeRow {
  id: string;
  name: string;
  normalizedName: string;
  type: string;
}

export interface GraphPathEdge {
  subject: string;
  predicate: string;
  object: string;
  strength: number;
  sourceDocIds: string[];
}

export interface GraphPath {
  nodes: string[];
  edges: GraphPathEdge[];
  score: number;
}

export interface GraphSearchResult {
  paths: GraphPath[];
  startNodes: GraphNodeRow[];
  exactMatch: boolean;
}

function toAgentStepDTO(raw: {
  tool?: unknown;
  args?: unknown;
  result?: unknown;
  tookMs?: unknown;
  phase?: unknown;
  createdAt?: unknown;
}): AgentStepDTO {
  const step: AgentStepDTO = {
    tool: String(raw.tool ?? ''),
    args: raw.args,
  };
  if ('result' in raw) step.result = raw.result;
  if (typeof raw.tookMs === 'number') step.tookMs = raw.tookMs;
  if (raw.phase === 'main' || raw.phase === 'graph') step.phase = raw.phase;
  if (raw.createdAt != null) step.createdAt = toIso(raw.createdAt);
  return step;
}

export interface JobRecordSummary {
  jobId: string;
  documentId: string;
  title?: string;
  status: string;
  error?: string | null;
  result?: unknown;
  createdAt?: string;
  updatedAt?: string;
  finishedAt?: string | null;
}

/** Map a raw jobs-collection row into the API-facing summary shape (shared by single + list reads). */
function mapJobRecord(row: {
  bullJobId: string;
  documentId?: ObjectId | string;
  title?: string;
  status?: string;
  error?: string | null;
  result?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  finishedAt?: unknown;
}): JobRecordSummary {
  return {
    jobId: row.bullJobId,
    documentId: row.documentId ? objectIdKey(row.documentId) : '',
    ...(row.title ? { title: row.title } : {}),
    status: row.status ?? 'unknown',
    error: row.error ?? null,
    ...(row.result != null ? { result: row.result } : {}),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    finishedAt: row.finishedAt == null ? null : toIso(row.finishedAt),
  };
}

function objectIdKey(value: unknown): string {
  return value instanceof ObjectId ? value.toHexString() : String(value);
}

function toGraphNode(row: Document): GraphNodeRow & { _id: unknown } {
  return {
    _id: row._id,
    id: objectIdKey(row._id),
    name: String(row.name ?? ''),
    normalizedName: String(row.normalizedName ?? ''),
    type: String(row.type ?? 'ENTITY'),
  };
}

function ngrams(value: string): Set<string> {
  const padded = ` ${value} `;
  const grams = new Set<string>();
  for (let i = 0; i < Math.max(1, padded.length - 1); i += 1) grams.add(padded.slice(i, i + 2));
  return grams;
}

function nameSimilarity(query: string, candidate: string): number {
  if (query === candidate) return 1;
  if (!query || !candidate) return 0;
  const containment = query.includes(candidate) || candidate.includes(query) ? 0.35 : 0;
  const queryGrams = ngrams(query);
  const candidateGrams = ngrams(candidate);
  const intersection = [...queryGrams].filter((gram) => candidateGrams.has(gram)).length;
  const union = new Set([...queryGrams, ...candidateGrams]).size || 1;
  return Math.min(1, containment + intersection / union);
}

async function rankedGraphStartNodes(
  db: Db,
  startEntity: string,
  fallbackK: number,
): Promise<{ nodes: Array<GraphNodeRow & { _id: unknown }>; exactMatch: boolean }> {
  const normalized = normalizeEntityName(startEntity);
  const exact = await db.collection('kg_nodes').findOne({ normalizedName: normalized });
  if (exact) return { nodes: [toGraphNode(exact)], exactMatch: true };

  // PoC: no exact match, so scan all nodes and score by bigram similarity in JS.
  // This is O(node count) per query; past PoC scale, replace with an index-backed
  // prefilter (text index or normalizedName $regex prefix) before client-side scoring.
  const candidates = await db
    .collection('kg_nodes')
    .find({}, { projection: { name: 1, normalizedName: 1, type: 1 } })
    .toArray();
  const nodes = candidates
    .map((row) => ({ node: toGraphNode(row), score: nameSimilarity(normalized, String(row.normalizedName ?? '')) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, fallbackK)
    .map((candidate) => candidate.node);

  return { nodes, exactMatch: false };
}

// Rank paths by mean edge strength, with a mild shorter-is-better tiebreak (1/sqrt(length)).
// We divide by sqrt(length) rather than length so a strong multi-hop path can still
// outrank a weak single hop — dividing by length again would penalize depth so hard that
// multi-hop retrieval becomes pointless.
function scoreGraphPath(edges: GraphPathEdge[]): number {
  if (edges.length === 0) return 0;
  const averageStrength = edges.reduce((sum, edge) => sum + edge.strength, 0) / edges.length;
  return averageStrength / Math.sqrt(edges.length);
}

export async function searchKnowledgeGraph(
  db: Db,
  input: {
    startEntity: string;
    maxDepth?: number;
    predicates?: string[];
    nodeLimit?: number;
    pathLimit?: number;
    fallbackK?: number;
  },
): Promise<GraphSearchResult> {
  const maxDepth = Math.min(Math.max(input.maxDepth ?? 2, 1), 3);
  const nodeLimit = input.nodeLimit ?? 200;
  const pathLimit = input.pathLimit ?? 50;
  const predicateSet = input.predicates?.length ? new Set(input.predicates) : undefined;
  const { nodes: startNodes, exactMatch } = await rankedGraphStartNodes(db, input.startEntity, input.fallbackK ?? 3);
  if (startNodes.length === 0) return { paths: [], startNodes: [], exactMatch: false };

  const nodeCollection = db.collection('kg_nodes');
  const edgeCollection = db.collection('kg_edges');
  const paths: GraphPath[] = [];
  const expanded = new Set<string>();
  let visitedCount = startNodes.length;

  const queue = startNodes.map((start) => ({
    current: start,
    nodeIds: [objectIdKey(start._id)],
    nodes: [start.name],
    edges: [] as GraphPathEdge[],
    depth: 0,
  }));

  while (queue.length > 0 && visitedCount <= nodeLimit && paths.length < pathLimit) {
    const currentPath = queue.shift()!;
    if (currentPath.depth >= maxDepth) continue;

    const currentKey = objectIdKey(currentPath.current._id);
    if (expanded.has(currentKey)) continue;
    expanded.add(currentKey);

    const edgeRows = await edgeCollection.find({ subjectId: currentPath.current._id }).toArray();
    const sortedEdges = edgeRows
      .filter((edge) => !predicateSet || predicateSet.has(String(edge.predicate ?? '')))
      .sort((a, b) => Number(b.strength ?? 0) - Number(a.strength ?? 0));

    for (const edge of sortedEdges) {
      if (paths.length >= pathLimit || visitedCount > nodeLimit) break;
      const object = await nodeCollection.findOne({ _id: edge.objectId });
      if (!object) continue;
      const objectNode = toGraphNode(object);
      const objectKey = objectIdKey(objectNode._id);
      if (currentPath.nodeIds.includes(objectKey)) continue;

      const sourceDocIds = Array.isArray(edge.sourceDocIds) ? edge.sourceDocIds.map(objectIdKey) : [];
      const pathEdge: GraphPathEdge = {
        subject: currentPath.current.name,
        predicate: String(edge.predicate ?? ''),
        object: objectNode.name,
        strength: typeof edge.strength === 'number' ? edge.strength : 0,
        sourceDocIds,
      };
      const nextPath = {
        current: objectNode,
        nodeIds: [...currentPath.nodeIds, objectKey],
        nodes: [...currentPath.nodes, objectNode.name],
        edges: [...currentPath.edges, pathEdge],
        depth: currentPath.depth + 1,
      };
      paths.push({
        nodes: nextPath.nodes,
        edges: nextPath.edges,
        score: scoreGraphPath(nextPath.edges),
      });
      queue.push(nextPath);
      visitedCount += 1;
    }
  }

  return {
    paths: paths.sort((a, b) => b.score - a.score).slice(0, pathLimit),
    startNodes: startNodes.map(({ _id, ...node }) => node),
    exactMatch,
  };
}

export function createJobsRepo(db: Db) {
  const collection = db.collection<{
    bullJobId: string;
    queue?: string;
    type?: string;
    documentId?: ObjectId | string;
    title?: string;
    status?: string;
    attempts?: number;
    error?: string | null;
    result?: unknown;
    createdAt?: Date;
    updatedAt?: Date;
    finishedAt?: Date | null;
    agentSteps?: Array<{
      tool: string;
      args: unknown;
      result?: unknown;
      tookMs?: number;
      phase?: 'main' | 'graph';
      createdAt: Date;
    }>;
  }>('jobs');

  return {
    async appendAgentStep(jobId: string, step: {
      tool: string;
      args: unknown;
      result?: unknown;
      tookMs?: number;
      phase?: 'main' | 'graph';
    }) {
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

    async getAgentSteps(jobId: string): Promise<AgentStepDTO[]> {
      const row = await collection.findOne({ bullJobId: jobId }, { projection: { agentSteps: 1 } });
      return (row?.agentSteps ?? []).map(toAgentStepDTO);
    },

    /** Batch variant of getAgentSteps: one query for many jobs, returned keyed by bullJobId. */
    async getAgentStepsBatch(jobIds: string[]): Promise<Map<string, AgentStepDTO[]>> {
      const map = new Map<string, AgentStepDTO[]>();
      if (jobIds.length === 0) return map;
      const rows = await collection
        .find({ bullJobId: { $in: jobIds } }, { projection: { bullJobId: 1, agentSteps: 1 } })
        .toArray();
      for (const row of rows) {
        map.set(row.bullJobId, (row.agentSteps ?? []).map(toAgentStepDTO));
      }
      return map;
    },

    async getJobRecord(jobId: string): Promise<JobRecordSummary | undefined> {
      const row = await collection.findOne({ bullJobId: jobId });
      if (!row) return undefined;
      return mapJobRecord(row);
    },

    async listAgentPreviewJobs(limit = 30): Promise<JobRecordSummary[]> {
      const rows = await collection
        .find({ queue: 'main', type: 'PREVIEW' })
        .sort({ createdAt: -1 })
        .limit(Math.min(Math.max(limit, 2), 30))
        .toArray();
      return rows.map(mapJobRecord);
    },

    async recordLifecycle(
      jobId: string,
      update: {
        queue: string;
        type: string;
        documentId: string;
        status: 'queued' | 'active' | 'completed' | 'failed';
        attempts?: number;
        error?: string | null;
        title?: string;
        result?: unknown;
      },
      options?: { insertOnly?: boolean },
    ) {
      const fields: Record<string, unknown> = {
        queue: update.queue,
        type: update.type,
        documentId: toObjectId(update.documentId) ?? update.documentId,
        status: update.status,
        attempts: update.attempts ?? 0,
        error: update.error ?? null,
        updatedAt: new Date(),
        finishedAt: update.status === 'completed' || update.status === 'failed' ? new Date() : null,
      };
      if (update.title) fields.title = update.title;
      if (update.result !== undefined) fields.result = update.result;
      // insertOnly is used for the API-side 'queued' write: it must not clobber a more advanced
      // status (e.g. 'active') a fast worker may have already written, so everything goes into
      // $setOnInsert and later worker $set writes win.
      if (options?.insertOnly) {
        await collection.updateOne(
          { bullJobId: jobId },
          { $setOnInsert: { createdAt: new Date(), ...fields } },
          { upsert: true },
        );
      } else {
        await collection.updateOne(
          { bullJobId: jobId },
          { $setOnInsert: { createdAt: new Date() }, $set: fields },
          { upsert: true },
        );
      }
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

/**
 * "연결 관계" data for a document: the facts (triplets) it contributed to the knowledge graph,
 * plus other documents that mention the same entities — so the reader can hop to related sources.
 * Drives the relations tab instead of a node-link graph view.
 */
export async function getDocumentConnections(db: Db, documentId: string): Promise<DocumentConnections> {
  const oid = toObjectId(documentId);
  if (!oid) return { facts: [], relatedDocs: [] };
  const edgeCollection = db.collection('kg_edges');
  const nodeCollection = db.collection('kg_nodes');
  const docCollection = db.collection('documents');

  const ownEdges = await edgeCollection.find({ sourceDocIds: oid }).toArray();
  if (ownEdges.length === 0) return { facts: [], relatedDocs: [] };

  // Resolve every node referenced by this doc's edges to a display name.
  const nodeIds = new Set<string>();
  for (const edge of ownEdges) {
    nodeIds.add(objectIdKey(edge.subjectId));
    nodeIds.add(objectIdKey(edge.objectId));
  }
  const nodeOids = [...nodeIds].filter((k) => ObjectId.isValid(k)).map((k) => new ObjectId(k));
  const nodeRows = await nodeCollection.find({ _id: { $in: nodeOids } }).toArray();
  const nodeName = new Map<string, string>();
  for (const row of nodeRows) nodeName.set(objectIdKey(row._id), String(row.name ?? ''));

  const facts: ConnectionFact[] = ownEdges
    .map((edge) => ({
      subject: nodeName.get(objectIdKey(edge.subjectId)) ?? '',
      predicate: String(edge.predicate ?? ''),
      object: nodeName.get(objectIdKey(edge.objectId)) ?? '',
      strength: typeof edge.strength === 'number' ? edge.strength : 0,
    }))
    .filter((fact) => fact.subject && fact.object)
    .sort((a, b) => b.strength - a.strength);

  // Edges from OTHER documents that touch the same entities.
  const otherEdges = await edgeCollection
    .find({ $or: [{ subjectId: { $in: nodeOids } }, { objectId: { $in: nodeOids } }] })
    .toArray();

  const ownKey = oid.toHexString();
  const byDoc = new Map<string, { entities: Set<string>; via: Map<string, string> }>();
  for (const edge of otherEdges) {
    const sharedNodeIds = [edge.subjectId, edge.objectId].map(objectIdKey).filter((k) => nodeIds.has(k));
    if (sharedNodeIds.length === 0) continue;
    const sourceDocIds: string[] = Array.isArray(edge.sourceDocIds) ? edge.sourceDocIds.map(objectIdKey) : [];
    for (const docKey of sourceDocIds) {
      if (docKey === ownKey) continue;
      let entry = byDoc.get(docKey);
      if (!entry) {
        entry = { entities: new Set(), via: new Map() };
        byDoc.set(docKey, entry);
      }
      for (const nid of sharedNodeIds) {
        const name = nodeName.get(nid);
        if (name) {
          entry.entities.add(name);
          if (!entry.via.has(name)) entry.via.set(name, String(edge.predicate ?? ''));
        }
      }
    }
  }

  const relatedDocs: RelatedDoc[] = [];
  if (byDoc.size > 0) {
    const docOids = [...byDoc.keys()].filter((k) => ObjectId.isValid(k)).map((k) => new ObjectId(k));
    const docRows = await docCollection
      .find({ _id: { $in: docOids }, trashed: { $ne: true } }, { projection: { title: 1, wiki: 1 } })
      .toArray();
    const titleById = new Map<string, string>();
    for (const row of docRows) {
      titleById.set(row._id.toString(), String((row.wiki as KnowledgeItem | undefined)?.title ?? row.title ?? 'Untitled'));
    }
    for (const [docKey, entry] of byDoc) {
      const title = titleById.get(docKey);
      if (!title) continue; // dropped: trashed or missing document
      relatedDocs.push({
        documentId: docKey,
        title,
        sharedEntities: [...entry.entities],
        via: [...entry.via.entries()].map(([entity, predicate]) => ({ entity, predicate })),
      });
    }
    relatedDocs.sort((a, b) => b.sharedEntities.length - a.sharedEntities.length);
  }

  return { facts, relatedDocs };
}

export async function upsertTriplets(db: Db, triplets: Triplet[], sourceDocId: string): Promise<void> {
  const sourceDocRef = toObjectId(sourceDocId);
  if (!sourceDocRef) throw new Error(`upsertTriplets: invalid sourceDocId ${sourceDocId}`);
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
          descriptions: { text: triplet.subject, sourceDocId: sourceDocRef },
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
          descriptions: { text: triplet.object, sourceDocId: sourceDocRef },
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
          sourceDocIds: sourceDocRef,
          descriptions: {
            text: `${triplet.subject} ${triplet.predicate} ${triplet.object}`,
            sourceDocId: sourceDocRef,
          },
        },
      },
      { upsert: true },
    );
  }
}
