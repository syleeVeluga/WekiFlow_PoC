import { randomUUID } from 'node:crypto';
import { InMemoryQueue } from '@wf/queue';
import {
  type CreateUserBody,
  type AgentPreviewResult,
  type AgentPreviewRun,
  type AgentStepDTO,
  type AppSettings,
  type DocumentConnections,
  type DocumentDTO,
  type TrashEntry,
  type AiTagSuggestion,
  type DailyDigest,
  type KnowledgeItem,
  type KnowledgeQuery,
  type MsResolveBody,
  type MultiSourceGroup,
  type ReviewItem,
  type RuntimeConfig,
  type RuntimeConfigPatch,
  type RuntimeConfigResponse,
  type Topic,
  type TreeCategory,
  type UpdateUserRoleBody,
  type UpdateAppSettings,
  type JobRef,
  type IngestionInfo,
  type CandidateStatus,
  type CreateKnowledgeCandidate,
  type KnowledgeCandidate,
  type KnowledgeCandidateListQuery,
  type SourceRef,
  type TreeNode,
  type User,
  type UserRole,
  DEFAULT_APP_SETTINGS,
  RuntimeConfigSchema,
  buildIngestionIdempotencyScope,
  UNCLASSIFIED_TOPIC_NAME,
  buildIngestedKnowledgeItem,
  canApprove,
  canReview,
  createSeedActivity,
  createSeedAiTagSuggestions,
  createSeedDigest,
  createSeedKnowledgeItems,
  createSeedMultiSourceGroups,
  createSeedReviews,
  createDefaultTopics,
  createDefaultRuntimeConfig,
  defaultCandidateStatusForProvenance,
  deriveTopicsFromItems,
  groupKnowledgeByCategory,
  ingestSourceNote,
  loadEnv,
  mergeRuntimeConfig,
  mergeRuntimeConfigPatch,
  normalizeEntityName,
  seedDemoUsers,
  canTransitionCandidate,
} from '@wf/shared';

export type ApproveResult =
  | { ok: true; doc: DocumentDTO; job: JobRef }
  | { ok: false; statusCode: number; error: string };

export type LoginResult =
  | { ok: true; token: string; user: User }
  | { ok: false; statusCode: number; error: string };

export type UserResult =
  | { ok: true; user: User }
  | { ok: false; statusCode: number; error: string };

export type OkResult = { ok: true } | { ok: false; statusCode: number; error: string };

export type SettingsResult =
  | { ok: true; settings: AppSettings }
  | { ok: false; statusCode: number; error: string };

export type CandidateResult =
  | { ok: true; candidate: KnowledgeCandidate }
  | { ok: false; statusCode: number; error: string };

export interface IngestInput {
  title: string;
  contentMarkdown: string;
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
}

/** Synthesizes the result returned when an idempotent ingest replays an existing document. */
export function buildReplayedIngestResult(doc: DocumentDTO): IngestResult {
  return {
    doc,
    job: {
      id: doc.ingestion?.jobId ?? `replayed-${doc.id}`,
      type: 'INGEST',
      documentId: doc.id,
      createdAt: doc.createdAt,
    },
    replayed: true,
  };
}

export interface IngestResult {
  doc: DocumentDTO;
  job: JobRef;
  replayed?: boolean;
}

export interface WekiFlowStore {
  seed?(): Promise<void> | void;
  tree(): Promise<TreeNode[]>;
  getDocument(id: string): Promise<DocumentDTO | undefined>;
  documentConnections(id: string): Promise<DocumentConnections>;
  trashDocument(id: string): Promise<DocumentDTO | undefined>;
  listTrash(): Promise<TrashEntry[]>;
  restoreDocument(id: string): Promise<DocumentDTO | undefined>;
  purgeDocument(id: string): Promise<boolean>;
  createDocument(input: {
    title: string;
    contentMarkdown?: string;
    parentId?: string | null;
  }): Promise<DocumentDTO>;
  ingest(input: IngestInput): Promise<IngestResult>;
  reviews(): Promise<DocumentDTO[]>;
  approve(id: string, role: UserRole): Promise<ApproveResult>;
  reject(id: string): Promise<DocumentDTO | undefined>;
  createCandidate(input: CreateKnowledgeCandidate): Promise<KnowledgeCandidate>;
  listCandidates(filter: KnowledgeCandidateListQuery): Promise<KnowledgeCandidate[]>;
  getCandidate(id: string): Promise<KnowledgeCandidate | undefined>;
  updateCandidateStatus(id: string, status: CandidateStatus): Promise<CandidateResult>;
  listKnowledge(q: KnowledgeQuery): Promise<KnowledgeItem[]>;
  getKnowledge(id: string): Promise<KnowledgeItem | null>;
  patchKnowledge(id: string, body: { contentMarkdown: string }): Promise<KnowledgeItem | null>;
  /**
   * Reassign a single page's topic. Empty/blank → 미분류. Trimming/defaulting is owned here, not by
   * callers. A reassignment is metadata, not a content edit, so it intentionally does NOT bump
   * modCount or append a lastChange/history entry (unlike patchKnowledge).
   */
  setKnowledgeCategory(id: string, category: string): Promise<KnowledgeItem | null>;
  listTopics(): Promise<Topic[]>;
  createTopic(name: string): Promise<Topic>;
  deleteTopic(id: string): Promise<{ ok: boolean; reassigned: number; statusCode?: number; error?: string }>;
  /** Remove a category by name: reassign its pages to 미분류 and drop any matching topic record. */
  declassifyCategory(name: string): Promise<{ ok: boolean; reassigned: number; statusCode?: number; error?: string }>;
  listAiTagSuggestions(): Promise<AiTagSuggestion[]>;
  resolveAiTagSuggestion(id: string, action: 'approve' | 'reject'): Promise<{ ok: boolean }>;
  listRichReviews(): Promise<ReviewItem[]>;
  resolveReview(id: string, action: 'approve' | 'reject', role: UserRole): Promise<ApproveResult>;
  listMultiSource(): Promise<MultiSourceGroup[]>;
  resolveMultiSource(id: string, body: MsResolveBody, role: UserRole): Promise<ApproveResult>;
  splitMultiSource(id: string): Promise<{ ok: boolean }>;
  requestConfirmMultiSource(id: string): Promise<{ ok: boolean }>;
  homeDigest(): Promise<DailyDigest>;
  listActivity(limit?: number): Promise<ReturnType<typeof createSeedActivity>>;
  treeCategories(): Promise<TreeCategory[]>;
  // --- Auth & users ---
  login(email: string, password: string): Promise<LoginResult>;
  me(token: string): Promise<User | undefined>;
  logout(token: string): Promise<void>;
  listUsers(): Promise<User[]>;
  createUser(body: CreateUserBody): Promise<UserResult>;
  updateUserRole(id: string, body: UpdateUserRoleBody): Promise<UserResult>;
  deleteUser(id: string): Promise<OkResult>;
  settings(): Promise<AppSettings>;
  updateSettings(body: UpdateAppSettings, role: UserRole): Promise<SettingsResult>;
  runtimeConfig(): Promise<RuntimeConfigResponse>;
  updateRuntimeConfig(patch: RuntimeConfigPatch): Promise<RuntimeConfigResponse>;
  agentPreview(input: { title: string; contentMarkdown: string; commit?: boolean }): Promise<{ jobId: string; documentId: string }>;
  getAgentPreview(jobId: string): Promise<AgentPreviewRun | undefined>;
  listAgentPreviews(): Promise<AgentPreviewRun[]>;
}

function stripPassword(user: User & { password: string }): User {
  const { password: _password, ...rest } = user;
  return rest;
}

export class InMemoryWekiFlowStore implements WekiFlowStore {
  readonly documents = new Map<string, DocumentDTO>();
  readonly mainQueue = new InMemoryQueue();
  readonly graphQueue = new InMemoryQueue();
  readonly knowledge = new Map<string, KnowledgeItem>();
  readonly topics = new Map<string, Topic>();
  readonly richReviews = new Map<string, ReviewItem>();
  readonly multiSource = new Map<string, MultiSourceGroup>();
  readonly aiTagSuggestions = new Map<string, AiTagSuggestion>();
  readonly candidates = new Map<string, KnowledgeCandidate>();
  readonly activity = createSeedActivity();
  readonly users = new Map<string, User & { password: string }>();
  readonly sessions = new Map<string, string>(); // token -> userId
  readonly agentRuns = new Map<string, AgentPreviewRun>();
  readonly trash = new Map<string, { item: KnowledgeItem; trashedAt: string }>();
  private settingsState: AppSettings = DEFAULT_APP_SETTINGS;
  private runtimeConfigState: RuntimeConfig = RuntimeConfigSchema.parse({});
  // Topic/workspace assigned at ingest, consumed on approve to materialize a KnowledgeItem.
  readonly ingestMeta = new Map<string, { topic?: string; workspace?: string; sourceLabel?: string }>();

  private sequence = 0;
  private userSequence = 0;
  private candidateSequence = 0;

  private addUser(name: string, email: string, role: UserRole, password: string, isSuperAdmin = false) {
    const id = `user-${++this.userSequence}`;
    this.users.set(id, { id, email, name, role, isSuperAdmin, password, createdAt: new Date().toISOString() });
  }

  private countOwners(): number {
    return [...this.users.values()].filter((user) => user.role === 'OWNER').length;
  }

  seed() {
    if (this.users.size === 0) {
      const env = loadEnv();
      this.addUser('소유자', env.ADMIN_EMAIL, 'OWNER', env.ADMIN_PASSWORD, true);
      for (const u of seedDemoUsers) this.addUser(u.name, u.email, u.role, u.email);
    }
    if (this.documents.size > 0) return;
    const now = new Date().toISOString();
    for (const topic of createDefaultTopics()) this.topics.set(topic.id, topic);
    for (const item of createSeedKnowledgeItems()) {
      this.knowledge.set(item.id, item);
      this.documents.set(item.id, {
        id: item.id,
        slug: item.id,
        title: item.title,
        parentId: null,
        isFolder: false,
        status: 'PUBLISHED',
        contentMarkdown: item.contentMarkdown,
        draftMarkdown: null,
        version: item.modCount + 1,
        sourceRefs: [{ type: 'datasource', ref: `seed://${item.id}`, note: item.sourceLabel }],
        createdAt: now,
        updatedAt: now,
      });
    }
    for (const review of createSeedReviews()) this.richReviews.set(review.id, review);
    for (const group of createSeedMultiSourceGroups()) this.multiSource.set(group.id, group);
    for (const suggestion of createSeedAiTagSuggestions()) this.aiTagSuggestions.set(suggestion.id, suggestion);
  }

  async tree(): Promise<TreeNode[]> {
    return [...this.documents.values()]
      .filter((doc) => doc.status !== 'PREVIEW')
      .map((doc) => ({
        id: doc.id,
        parentId: doc.parentId,
        title: doc.title,
        slug: doc.slug,
        isFolder: doc.isFolder,
        status: doc.status,
      }));
  }

  async getDocument(id: string): Promise<DocumentDTO | undefined> {
    return this.documents.get(id);
  }

  async documentConnections(): Promise<DocumentConnections> {
    // In-memory store has no knowledge graph; the relations view is populated only under Mongo.
    return { facts: [], relatedDocs: [] };
  }

  async trashDocument(id: string): Promise<DocumentDTO | undefined> {
    const item = this.knowledge.get(id);
    if (item) {
      this.trash.set(id, { item, trashedAt: new Date().toISOString() });
      this.knowledge.delete(id);
    }
    return this.documents.get(id);
  }

  async listTrash(): Promise<TrashEntry[]> {
    return [...this.trash.entries()].map(([id, { item, trashedAt }]) => ({
      id,
      title: item.title,
      category: item.category,
      trashedAt,
    }));
  }

  async restoreDocument(id: string): Promise<DocumentDTO | undefined> {
    const entry = this.trash.get(id);
    if (entry) {
      this.knowledge.set(id, entry.item);
      this.trash.delete(id);
    }
    return this.documents.get(id);
  }

  async purgeDocument(id: string): Promise<boolean> {
    const had = this.trash.delete(id);
    if (!had) return false;
    this.documents.delete(id);
    return true;
  }

  private create(input: {
    title: string;
    contentMarkdown: string;
    parentId?: string | null;
    status: DocumentDTO['status'];
    sourceRefs: DocumentDTO['sourceRefs'];
    ingestion?: IngestionInfo;
  }): DocumentDTO {
    const now = new Date().toISOString();
    const id = `doc-${++this.sequence + 1}`;
    const doc: DocumentDTO = {
      id,
      slug: input.title.toLowerCase().replace(/\s+/g, '-'),
      title: input.title,
      parentId: input.parentId ?? null,
      isFolder: false,
      status: input.status,
      contentMarkdown: input.contentMarkdown,
      draftMarkdown: null,
      version: 1,
      sourceRefs: input.sourceRefs,
      ...(input.ingestion ? { ingestion: input.ingestion } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.documents.set(id, doc);
    return doc;
  }

  async createDocument(input: {
    title: string;
    contentMarkdown?: string;
    parentId?: string | null;
  }): Promise<DocumentDTO> {
    return this.create({
      title: input.title,
      contentMarkdown: input.contentMarkdown ?? '',
      parentId: input.parentId ?? null,
      status: 'DRAFT',
      sourceRefs: [],
    });
  }

  private findByIngestionScope(scope: string): DocumentDTO | undefined {
    return [...this.documents.values()].find((doc) => doc.ingestion?.idempotencyScope === scope);
  }

  async ingest(input: IngestInput): Promise<IngestResult> {
    const idempotencyScope = buildIngestionIdempotencyScope(input.ingestion ?? {});
    if (idempotencyScope) {
      const existing = this.findByIngestionScope(idempotencyScope);
      if (existing) return buildReplayedIngestResult(existing);
    }

    let created = this.create({
      title: input.title,
      contentMarkdown: input.contentMarkdown,
      parentId: input.parentId ?? null,
      status: 'PROCESSING',
      sourceRefs: [
        {
          type: input.sourceType ?? 'manual',
          ref: input.sourceRef ?? 'api://ingest',
          note: ingestSourceNote(input),
        },
      ],
      ...(input.ingestion
        ? {
            ingestion: {
              ...input.ingestion,
              ...(idempotencyScope ? { idempotencyScope } : {}),
              receivedAt: new Date().toISOString(),
            },
          }
        : {}),
    });
    // Retain the assigned topic/workspace so approve() can materialize a KnowledgeItem (the in-memory
    // tree/KB read from this.knowledge, so an approved doc must land there to appear in the tree).
    this.ingestMeta.set(created.id, {
      ...(input.topic ? { topic: input.topic } : {}),
      ...(input.workspace ? { workspace: input.workspace } : {}),
      ...(input.sourceLabel ? { sourceLabel: input.sourceLabel } : {}),
    });
    const job = this.mainQueue.add('INGEST', { documentId: created.id });
    if (created.ingestion) {
      created = { ...created, ingestion: { ...created.ingestion, jobId: job.id } };
      this.documents.set(created.id, created);
    }
    // In-memory path runs the stub main worker inline so route tests stay hermetic.
    await this.applyStubMainWorker(created.id);
    return { doc: this.documents.get(created.id)!, job };
  }

  async applyStubMainWorker(id: string) {
    const doc = this.documents.get(id);
    if (!doc) return;
    const now = new Date().toISOString();
    this.documents.set(id, {
      ...doc,
      status: 'REVIEW',
      draftMarkdown: `${doc.contentMarkdown}\n\n[stub-merged-by-main-worker]`,
      updatedAt: now,
    });
    if (!this.settingsState.reviewApprovalEnabled) {
      await this.publishDocument(id);
    }
  }

  async reviews(): Promise<DocumentDTO[]> {
    return [...this.documents.values()].filter((doc) => doc.status === 'REVIEW');
  }

  async agentPreview(input: { title: string; contentMarkdown: string; commit?: boolean }): Promise<{ jobId: string; documentId: string }> {
    const sequence = this.agentRuns.size + 1;
    const jobId = `preview-${sequence}`;
    const committedDraft = `${input.contentMarkdown}\n\n[preview-stub-merged]`;
    const committedDoc = input.commit
      ? this.create({
          title: input.title,
          contentMarkdown: input.contentMarkdown,
          status: 'REVIEW',
          sourceRefs: [{ type: 'manual', ref: 'api://agent-preview', note: '' }],
        })
      : null;
    if (committedDoc) {
      this.documents.set(committedDoc.id, { ...committedDoc, draftMarkdown: committedDraft });
      if (!this.settingsState.reviewApprovalEnabled) {
        await this.publishDocument(committedDoc.id);
      }
    }
    const documentId = committedDoc?.id ?? `preview-doc-${sequence}`;
    const now = new Date().toISOString();
    const steps: AgentStepDTO[] = [
      {
        tool: 'tool_search_vector',
        phase: 'main',
        args: { query: input.title, k: 4 },
        result: { count: 1, topScore: 0.91 },
        tookMs: 12,
        createdAt: now,
      },
      {
        tool: 'tool_merge',
        phase: 'main',
        args: { documentId, factCount: 1 },
        result: { changeSummary: 'Preview stub merge completed.' },
        tookMs: 18,
        createdAt: now,
      },
      {
        tool: 'tool_extract_triplets',
        phase: 'graph',
        args: { documentId, chunkIndex: 0, headingPath: [] },
        result: { tripletCount: 1 },
        tookMs: 9,
        createdAt: now,
      },
    ];
    const result: AgentPreviewResult = {
      documentId,
      originalMarkdown: input.contentMarkdown,
      draftMarkdown: committedDraft,
      changeSummary: 'Preview stub merge completed.',
      merged: true,
      chunkCount: 1,
      tripletCount: 1,
      ...(input.commit ? { committed: true } : {}),
      triplets: [
        {
          subject: input.title,
          predicate: 'previews',
          object: 'Agent pipeline',
          subjectType: 'DOCUMENT',
          objectType: 'PROCESS',
          strength: 0.8,
        },
      ],
    };
    this.agentRuns.set(jobId, {
      jobId,
      documentId,
      title: input.title,
      status: 'completed',
      steps,
      result,
      createdAt: now,
      updatedAt: now,
    });
    return { jobId, documentId };
  }

  async getAgentPreview(jobId: string): Promise<AgentPreviewRun | undefined> {
    return this.agentRuns.get(jobId);
  }

  async listAgentPreviews(): Promise<AgentPreviewRun[]> {
    return [...this.agentRuns.values()]
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
      .slice(0, 30);
  }

  async approve(id: string, role: UserRole): Promise<ApproveResult> {
    if (!canApprove(role)) {
      return { ok: false, statusCode: 403, error: 'Forbidden' };
    }
    return this.publishDocument(id);
  }

  private async publishPendingReviews(): Promise<void> {
    const ids = [...this.documents.values()].filter((doc) => doc.status === 'REVIEW').map((doc) => doc.id);
    for (const id of ids) await this.publishDocument(id);
  }

  private async publishDocument(id: string): Promise<ApproveResult> {
    const doc = this.documents.get(id);
    if (!doc) {
      return { ok: false, statusCode: 404, error: 'Not found' };
    }
    const now = new Date().toISOString();
    const published: DocumentDTO = {
      ...doc,
      status: 'PUBLISHED',
      contentMarkdown: doc.draftMarkdown ?? doc.contentMarkdown,
      draftMarkdown: null,
      version: doc.version + 1,
      updatedAt: now,
    };
    this.documents.set(id, published);
    // Materialize (or refresh) the KnowledgeItem so the published doc appears in the tree/KB under
    // its assigned topic. Seeded docs (already knowledge) keep their existing item.
    const meta = this.ingestMeta.get(id);
    if (meta || !this.knowledge.has(id)) {
      const knowledge = buildIngestedKnowledgeItem({
        id,
        title: published.title,
        contentMarkdown: published.contentMarkdown,
        ...(meta?.topic ? { category: meta.topic } : {}),
        ...(meta?.workspace ? { workspace: meta.workspace } : {}),
        ...(meta?.sourceLabel ? { sourceLabel: meta.sourceLabel } : {}),
        at: now,
        existing: this.knowledge.get(id) ?? null,
      });
      this.knowledge.set(id, knowledge);
    }
    const job = this.graphQueue.add('EXTRACT_TRIPLETS', { documentId: id });
    return { ok: true, doc: published, job };
  }

  async reject(id: string): Promise<DocumentDTO | undefined> {
    const doc = this.documents.get(id);
    if (!doc) return undefined;
    const updated: DocumentDTO = { ...doc, status: 'DRAFT', draftMarkdown: null };
    this.documents.set(id, updated);
    return updated;
  }

  async createCandidate(input: CreateKnowledgeCandidate): Promise<KnowledgeCandidate> {
    const now = new Date().toISOString();
    const candidate: KnowledgeCandidate = {
      id: `candidate-${++this.candidateSequence}`,
      title: input.title,
      summary: input.summary ?? '',
      bodyMarkdown: input.bodyMarkdown ?? '',
      status: input.status ?? defaultCandidateStatusForProvenance(input.provenance),
      riskFactors: input.riskFactors ?? [],
      provenance: input.provenance,
      linkedDocId: input.linkedDocId ?? null,
      conflictWith: input.conflictWith ?? [],
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.candidates.set(candidate.id, candidate);
    return candidate;
  }

  async listCandidates(filter: KnowledgeCandidateListQuery): Promise<KnowledgeCandidate[]> {
    return [...this.candidates.values()]
      .filter((candidate) => !filter.status || candidate.status === filter.status)
      .filter((candidate) => !filter.riskFactor || candidate.riskFactors.includes(filter.riskFactor))
      .filter((candidate) => !filter.provenanceKind || candidate.provenance.kind === filter.provenanceKind)
      .filter((candidate) => !filter.workspaceId || candidate.workspaceId === filter.workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getCandidate(id: string): Promise<KnowledgeCandidate | undefined> {
    return this.candidates.get(id);
  }

  async updateCandidateStatus(id: string, status: CandidateStatus): Promise<CandidateResult> {
    const candidate = this.candidates.get(id);
    if (!candidate) return { ok: false, statusCode: 404, error: 'Not found' };
    if (!canTransitionCandidate(candidate.status, status)) {
      return { ok: false, statusCode: 400, error: `Invalid candidate status transition: ${candidate.status} -> ${status}` };
    }
    const updated = { ...candidate, status, updatedAt: new Date().toISOString() };
    this.candidates.set(id, updated);
    return { ok: true, candidate: updated };
  }

  async listKnowledge(q: KnowledgeQuery): Promise<KnowledgeItem[]> {
    const query = normalizeEntityName(q.q ?? '');
    const personDept: Record<string, string> = { 이지수: '총무팀', 박민지: '인사팀', 김도윤: 'IT팀', 최서연: '재무팀', 한준호: '영업팀' };
    const filtered = [...this.knowledge.values()].filter((item) => {
      const personOk = q.person === 'all' || item.authorName === q.person || item.department === personDept[q.person ?? ''];
      const topicOk = q.topic === 'all' || item.category === q.topic;
      const tagOk = !q.tag || item.aiTags.includes(q.tag);
      const statusOk = q.status === 'all' || item.freshness === q.status;
      const qOk =
        !query ||
        normalizeEntityName(`${item.title} ${item.summary} ${item.aiTags.join(' ')}`).includes(query);
      return personOk && topicOk && tagOk && statusOk && qOk;
    });
    return filtered.sort((a, b) => {
      if (q.sort === 'alpha') return a.title.localeCompare(b.title, 'ko');
      if (q.sort === 'recent') return b.modCount - a.modCount || b.usageCount - a.usageCount;
      return b.usageCount - a.usageCount;
    });
  }

  async getKnowledge(id: string): Promise<KnowledgeItem | null> {
    return this.knowledge.get(id) ?? null;
  }

  async patchKnowledge(id: string, body: { contentMarkdown: string }): Promise<KnowledgeItem | null> {
    const current = this.knowledge.get(id);
    if (!current) return null;
    const updated = {
      ...current,
      contentMarkdown: body.contentMarkdown,
      modCount: current.modCount + 1,
      updatedAtLabel: '방금 전',
      lastChange: { label: '수동 편집', at: new Date().toISOString(), by: '이지수', source: '웹 편집' },
    };
    this.knowledge.set(id, updated);
    const doc = this.documents.get(id);
    if (doc) this.documents.set(id, { ...doc, contentMarkdown: updated.contentMarkdown, version: doc.version + 1 });
    return updated;
  }

  async setKnowledgeCategory(id: string, category: string): Promise<KnowledgeItem | null> {
    const current = this.knowledge.get(id);
    if (!current) return null;
    const next = category.trim() || UNCLASSIFIED_TOPIC_NAME;
    const updated = { ...current, category: next };
    this.knowledge.set(id, updated);
    return updated;
  }

  async listTopics(): Promise<Topic[]> {
    const counts = new Map<string, number>();
    for (const item of this.knowledge.values()) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    return deriveTopicsFromItems([...this.topics.values()], counts.keys()).map((topic) => ({ ...topic, count: counts.get(topic.name) ?? 0 }));
  }

  async createTopic(name: string): Promise<Topic> {
    if (name === UNCLASSIFIED_TOPIC_NAME) return createDefaultTopics()[0]!;
    const existing = [...this.topics.values()].find((topic) => topic.name === name);
    if (existing) return existing;
    const topic: Topic = { id: `topic-user-${this.topics.size + 1}`, name, source: 'user', isUnclassified: false, count: 0 };
    this.topics.set(topic.id, topic);
    return topic;
  }

  async deleteTopic(id: string): Promise<{ ok: boolean; reassigned: number; statusCode?: number; error?: string }> {
    const topic = this.topics.get(id);
    if (!topic) return { ok: false, reassigned: 0, statusCode: 404, error: 'Not found' };
    if (topic.source === 'system') return { ok: false, reassigned: 0, statusCode: 400, error: 'System topic cannot be deleted' };
    let reassigned = 0;
    for (const [itemId, item] of this.knowledge) {
      if (item.category === topic.name) {
        this.knowledge.set(itemId, { ...item, category: UNCLASSIFIED_TOPIC_NAME });
        reassigned += 1;
      }
    }
    this.topics.delete(id);
    return { ok: true, reassigned };
  }

  async declassifyCategory(name: string): Promise<{ ok: boolean; reassigned: number; statusCode?: number; error?: string }> {
    if (name === UNCLASSIFIED_TOPIC_NAME) return { ok: false, reassigned: 0, statusCode: 400, error: '미분류는 삭제할 수 없습니다.' };
    let reassigned = 0;
    for (const [itemId, item] of this.knowledge) {
      if (item.category === name) {
        this.knowledge.set(itemId, { ...item, category: UNCLASSIFIED_TOPIC_NAME });
        reassigned += 1;
      }
    }
    for (const [topicId, topic] of this.topics) {
      if (topic.name === name && !topic.isUnclassified) this.topics.delete(topicId);
    }
    return { ok: true, reassigned };
  }

  async listAiTagSuggestions(): Promise<AiTagSuggestion[]> {
    return [...this.aiTagSuggestions.values()].filter((item) => item.status === 'pending');
  }

  async resolveAiTagSuggestion(id: string, action: 'approve' | 'reject'): Promise<{ ok: boolean }> {
    const suggestion = this.aiTagSuggestions.get(id);
    if (!suggestion) return { ok: false };
    if (action === 'approve') {
      const item = this.knowledge.get(suggestion.itemId);
      if (item && !item.aiTags.includes(suggestion.tag)) {
        this.knowledge.set(item.id, { ...item, aiTags: [...item.aiTags, suggestion.tag] });
      }
    }
    this.aiTagSuggestions.set(id, { ...suggestion, status: action === 'approve' ? 'approved' : 'rejected' });
    return { ok: true };
  }

  async listRichReviews(): Promise<ReviewItem[]> {
    return [...this.richReviews.values()].filter((item) => !item.resolved);
  }

  async resolveReview(id: string, action: 'approve' | 'reject', role: UserRole): Promise<ApproveResult> {
    // 승인은 승인(APPROVER) 이상, 반려는 검토(REVIEWER) 이상.
    if (!(action === 'approve' ? canApprove(role) : canReview(role))) {
      return { ok: false, statusCode: 403, error: 'Forbidden' };
    }
    const review = this.richReviews.get(id);
    if (!review) return { ok: false, statusCode: 404, error: 'Not found' };
    this.richReviews.set(id, { ...review, resolved: true });
    const targetId = review.documentId ?? 'k01';
    if (action === 'approve') {
      const item = this.knowledge.get(targetId);
      if (item) await this.patchKnowledge(item.id, { contentMarkdown: `${item.contentMarkdown}\n\n${review.newContent}` });
    }
    const doc = this.documents.get(targetId) ?? [...this.documents.values()][0]!;
    return { ok: true, doc, job: this.graphQueue.add('EXTRACT_TRIPLETS', { documentId: doc.id }) };
  }

  async listMultiSource(): Promise<MultiSourceGroup[]> {
    return [...this.multiSource.values()].filter((item) => !item.resolved);
  }

  async resolveMultiSource(id: string, body: MsResolveBody, role: UserRole): Promise<ApproveResult> {
    if (!canApprove(role)) return { ok: false, statusCode: 403, error: 'Forbidden' };
    const group = this.multiSource.get(id);
    if (!group) return { ok: false, statusCode: 404, error: 'Not found' };
    if (group.multiSourceType === 'C') return { ok: false, statusCode: 409, error: 'Conflicting multi-source group requires confirmation' };
    if (group.multiSourceType === 'B' && !body.selectedVersion) return { ok: false, statusCode: 400, error: 'selectedVersion is required' };
    const content = body.content ?? group.resolvedContent ?? '';
    for (const targetId of body.targetIds) {
      const item = this.knowledge.get(targetId);
      if (item) await this.patchKnowledge(targetId, { contentMarkdown: `${item.contentMarkdown}\n\n${content}` });
    }
    this.multiSource.set(id, { ...group, resolved: true });
    const doc = this.documents.get(body.targetIds[0]!) ?? [...this.documents.values()][0]!;
    return { ok: true, doc, job: this.graphQueue.add('EXTRACT_TRIPLETS', { documentId: doc.id }) };
  }

  async splitMultiSource(id: string): Promise<{ ok: boolean }> {
    const group = this.multiSource.get(id);
    if (!group) return { ok: false };
    this.multiSource.set(id, { ...group, resolved: true });
    return { ok: true };
  }

  async requestConfirmMultiSource(id: string): Promise<{ ok: boolean }> {
    const group = this.multiSource.get(id);
    if (!group) return { ok: false };
    this.multiSource.set(id, { ...group, resolved: true });
    return { ok: true };
  }

  async homeDigest(): Promise<DailyDigest> {
    if (!this.settingsState.reviewApprovalEnabled) return createSeedDigest(0);
    const pendingReview = (await this.listRichReviews()).length + (await this.listMultiSource()).length;
    return createSeedDigest(pendingReview);
  }

  async listActivity(limit = 5): Promise<ReturnType<typeof createSeedActivity>> {
    return this.activity.slice(0, limit);
  }

  async treeCategories(): Promise<TreeCategory[]> {
    return groupKnowledgeByCategory([...this.knowledge.values()], await this.listTopics());
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const user = [...this.users.values()].find((candidate) => candidate.email === email);
    if (!user || user.password !== password) {
      return { ok: false, statusCode: 401, error: '이메일 또는 비밀번호가 올바르지 않습니다.' };
    }
    const token = randomUUID();
    this.sessions.set(token, user.id);
    return { ok: true, token, user: stripPassword(user) };
  }

  async me(token: string): Promise<User | undefined> {
    const userId = this.sessions.get(token);
    if (!userId) return undefined;
    const user = this.users.get(userId);
    return user ? stripPassword(user) : undefined;
  }

  async logout(token: string): Promise<void> {
    this.sessions.delete(token);
  }

  async listUsers(): Promise<User[]> {
    return [...this.users.values()].map(stripPassword);
  }

  async createUser(body: CreateUserBody): Promise<UserResult> {
    if ([...this.users.values()].some((user) => user.email === body.email)) {
      return { ok: false, statusCode: 409, error: '이미 존재하는 이메일입니다.' };
    }
    // PoC: 비밀번호는 이메일과 동일하게 발급.
    this.addUser(body.name, body.email, body.role, body.email, body.isSuperAdmin);
    const created = [...this.users.values()].find((user) => user.email === body.email)!;
    return { ok: true, user: stripPassword(created) };
  }

  async updateUserRole(id: string, body: UpdateUserRoleBody): Promise<UserResult> {
    const user = this.users.get(id);
    if (!user) return { ok: false, statusCode: 404, error: '사용자를 찾을 수 없습니다.' };
    const role = body.role;
    if (user.role === 'OWNER' && role !== 'OWNER' && this.countOwners() <= 1) {
      return { ok: false, statusCode: 400, error: '마지막 소유자의 권한은 변경할 수 없습니다.' };
    }
    const updated = { ...user, role, ...(body.isSuperAdmin !== undefined ? { isSuperAdmin: body.isSuperAdmin } : {}) };
    this.users.set(id, updated);
    return { ok: true, user: stripPassword(updated) };
  }

  async deleteUser(id: string): Promise<OkResult> {
    const user = this.users.get(id);
    if (!user) return { ok: false, statusCode: 404, error: '사용자를 찾을 수 없습니다.' };
    if (user.role === 'OWNER' && this.countOwners() <= 1) {
      return { ok: false, statusCode: 400, error: '마지막 소유자는 삭제할 수 없습니다.' };
    }
    this.users.delete(id);
    for (const [token, userId] of this.sessions) if (userId === id) this.sessions.delete(token);
    return { ok: true };
  }

  async settings(): Promise<AppSettings> {
    return this.settingsState;
  }

  async updateSettings(body: UpdateAppSettings, role: UserRole): Promise<SettingsResult> {
    if (!canApprove(role)) return { ok: false, statusCode: 403, error: 'Forbidden' };
    if (body.reviewApprovalEnabled === false) await this.publishPendingReviews();
    this.settingsState =
      body.reviewApprovalEnabled === undefined
        ? this.settingsState
        : { ...this.settingsState, reviewApprovalEnabled: body.reviewApprovalEnabled };
    return { ok: true, settings: this.settingsState };
  }

  async runtimeConfig(): Promise<RuntimeConfigResponse> {
    const defaults = createDefaultRuntimeConfig(loadEnv());
    return {
      defaults,
      overrides: this.runtimeConfigState,
      effective: mergeRuntimeConfig(defaults, this.runtimeConfigState),
    };
  }

  async updateRuntimeConfig(patch: RuntimeConfigPatch): Promise<RuntimeConfigResponse> {
    this.runtimeConfigState = mergeRuntimeConfigPatch(this.runtimeConfigState, patch);
    return this.runtimeConfig();
  }
}
