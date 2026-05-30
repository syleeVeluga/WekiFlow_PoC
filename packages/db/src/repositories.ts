import { ObjectId, type Db, type Document, type WithId } from 'mongodb';
import { randomUUID } from 'node:crypto';
import {
  normalizeEntityName,
  type DocumentDTO,
  type DocumentStatus,
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
    status?: string;
    attempts?: number;
    error?: string | null;
    finishedAt?: Date | null;
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

    async recordLifecycle(
      jobId: string,
      update: {
        queue: string;
        type: string;
        documentId: string;
        status: 'active' | 'completed' | 'failed';
        attempts?: number;
        error?: string | null;
      },
    ) {
      await collection.updateOne(
        { bullJobId: jobId },
        {
          $setOnInsert: { createdAt: new Date() },
          $set: {
            queue: update.queue,
            type: update.type,
            documentId: toObjectId(update.documentId) ?? update.documentId,
            status: update.status,
            attempts: update.attempts ?? 0,
            error: update.error ?? null,
            updatedAt: new Date(),
            finishedAt: update.status === 'active' ? null : new Date(),
          },
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
