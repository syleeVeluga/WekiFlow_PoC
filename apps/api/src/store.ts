import { randomUUID } from 'node:crypto';
import { InMemoryQueue } from '@wf/queue';
import {
  type CreateUserBody,
  type AgentPreviewResult,
  type AgentPreviewRun,
  type AgentStepDTO,
  type DocumentDTO,
  type AiTagSuggestion,
  type DailyDigest,
  type KnowledgeItem,
  type KnowledgeQuery,
  type MsResolveBody,
  type MultiSourceGroup,
  type ReviewItem,
  type Topic,
  type TreeCategory,
  type JobRef,
  type TreeNode,
  type User,
  type UserRole,
  canApprove,
  canReview,
  createSeedActivity,
  createSeedAiTagSuggestions,
  createSeedDigest,
  createSeedKnowledgeItems,
  createSeedMultiSourceGroups,
  createSeedReviews,
  createSeedTopics,
  groupKnowledgeByCategory,
  loadEnv,
  normalizeEntityName,
  seedDemoUsers,
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

export interface WekiFlowStore {
  seed?(): Promise<void> | void;
  tree(): Promise<TreeNode[]>;
  getDocument(id: string): Promise<DocumentDTO | undefined>;
  createDocument(input: {
    title: string;
    contentMarkdown?: string;
    parentId?: string | null;
  }): Promise<DocumentDTO>;
  ingest(input: {
    title: string;
    contentMarkdown: string;
    parentId?: string | null;
  }): Promise<{ doc: DocumentDTO; job: JobRef }>;
  reviews(): Promise<DocumentDTO[]>;
  approve(id: string, role: UserRole): Promise<ApproveResult>;
  reject(id: string): Promise<DocumentDTO | undefined>;
  listKnowledge(q: KnowledgeQuery): Promise<KnowledgeItem[]>;
  getKnowledge(id: string): Promise<KnowledgeItem | null>;
  patchKnowledge(id: string, body: { contentMarkdown: string }): Promise<KnowledgeItem | null>;
  listTopics(): Promise<Topic[]>;
  createTopic(name: string): Promise<Topic>;
  deleteTopic(id: string): Promise<{ ok: boolean; reassigned: number; statusCode?: number; error?: string }>;
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
  updateUserRole(id: string, role: UserRole): Promise<UserResult>;
  deleteUser(id: string): Promise<OkResult>;
  agentPreview(input: { title: string; contentMarkdown: string }): Promise<{ jobId: string; documentId: string }>;
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
  readonly activity = createSeedActivity();
  readonly users = new Map<string, User & { password: string }>();
  readonly sessions = new Map<string, string>(); // token -> userId
  readonly agentRuns = new Map<string, AgentPreviewRun>();

  private sequence = 0;
  private userSequence = 0;

  private addUser(name: string, email: string, role: UserRole, password: string) {
    const id = `user-${++this.userSequence}`;
    this.users.set(id, { id, email, name, role, password, createdAt: new Date().toISOString() });
  }

  private countOwners(): number {
    return [...this.users.values()].filter((user) => user.role === 'OWNER').length;
  }

  seed() {
    if (this.users.size === 0) {
      const env = loadEnv();
      this.addUser('소유자', env.ADMIN_EMAIL, 'OWNER', env.ADMIN_PASSWORD);
      for (const u of seedDemoUsers) this.addUser(u.name, u.email, u.role, u.email);
    }
    if (this.documents.size > 0) return;
    const now = new Date().toISOString();
    for (const topic of createSeedTopics()) this.topics.set(topic.id, topic);
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

  private create(input: {
    title: string;
    contentMarkdown: string;
    parentId?: string | null;
    status: DocumentDTO['status'];
    sourceRefs: DocumentDTO['sourceRefs'];
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

  async ingest(input: {
    title: string;
    contentMarkdown: string;
    parentId?: string | null;
  }): Promise<{ doc: DocumentDTO; job: JobRef }> {
    const created = this.create({
      title: input.title,
      contentMarkdown: input.contentMarkdown,
      parentId: input.parentId ?? null,
      status: 'PROCESSING',
      sourceRefs: [{ type: 'manual', ref: 'api://ingest', note: '' }],
    });
    const job = this.mainQueue.add('INGEST', { documentId: created.id });
    // In-memory path runs the stub main worker inline so route tests stay hermetic.
    this.applyStubMainWorker(created.id);
    return { doc: this.documents.get(created.id)!, job };
  }

  applyStubMainWorker(id: string) {
    const doc = this.documents.get(id);
    if (!doc) return;
    const now = new Date().toISOString();
    this.documents.set(id, {
      ...doc,
      status: 'REVIEW',
      draftMarkdown: `${doc.contentMarkdown}\n\n[stub-merged-by-main-worker]`,
      updatedAt: now,
    });
  }

  async reviews(): Promise<DocumentDTO[]> {
    return [...this.documents.values()].filter((doc) => doc.status === 'REVIEW');
  }

  async agentPreview(input: { title: string; contentMarkdown: string }): Promise<{ jobId: string; documentId: string }> {
    const sequence = this.agentRuns.size + 1;
    const jobId = `preview-${sequence}`;
    const documentId = `preview-doc-${sequence}`;
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
      draftMarkdown: `${input.contentMarkdown}\n\n[preview-stub-merged]`,
      changeSummary: 'Preview stub merge completed.',
      merged: true,
      chunkCount: 1,
      tripletCount: 1,
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

  async listTopics(): Promise<Topic[]> {
    const counts = new Map<string, number>();
    for (const item of this.knowledge.values()) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    return [...this.topics.values()].map((topic) => ({ ...topic, count: counts.get(topic.name) ?? 0 }));
  }

  async createTopic(name: string): Promise<Topic> {
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
        this.knowledge.set(itemId, { ...item, category: '미분류' });
        reassigned += 1;
      }
    }
    this.topics.delete(id);
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
    this.addUser(body.name, body.email, body.role, body.email);
    const created = [...this.users.values()].find((user) => user.email === body.email)!;
    return { ok: true, user: stripPassword(created) };
  }

  async updateUserRole(id: string, role: UserRole): Promise<UserResult> {
    const user = this.users.get(id);
    if (!user) return { ok: false, statusCode: 404, error: '사용자를 찾을 수 없습니다.' };
    if (user.role === 'OWNER' && role !== 'OWNER' && this.countOwners() <= 1) {
      return { ok: false, statusCode: 400, error: '마지막 소유자의 권한은 변경할 수 없습니다.' };
    }
    const updated = { ...user, role };
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
}
