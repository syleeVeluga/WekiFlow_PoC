import type { Queue } from 'bullmq';
import type { Db } from 'mongodb';
import { createDocumentsRepo, createJobsRepo, createUsersRepo, toDocumentDTO } from '@wf/db';
import { defaultJobOptions } from '@wf/queue';
import {
  AgentPreviewResultSchema,
  KnowledgeQuerySchema,
  type AgentPreviewResult,
  type AgentPreviewRun,
  type CreateUserBody,
  type DocumentDTO,
  type ActivityEntry,
  type AiTagSuggestion,
  type DailyDigest,
  type JobRef,
  type JobType,
  type KnowledgeItem,
  type KnowledgeQuery,
  type MsResolveBody,
  type MultiSourceGroup,
  type ReviewItem,
  type Topic,
  type TreeCategory,
  type TreeNode,
  type User,
  type UserRole,
  canApprove,
  canReview,
  createSeedDigest,
  groupKnowledgeByCategory,
  loadEnv,
  normalizeEntityName,
} from '@wf/shared';
import type { ApproveResult, LoginResult, OkResult, UserResult, WekiFlowStore } from './store.js';

function normalizePreviewState(state: string | undefined): AgentPreviewRun['status'] {
  if (state === 'completed') return 'completed';
  if (state === 'failed') return 'failed';
  if (state === 'active') return 'active';
  if (state === 'queued' || state === 'waiting' || state === 'delayed' || state === 'prioritized') return 'queued';
  return 'unknown';
}

function parsePreviewResult(value: unknown): AgentPreviewResult | undefined {
  const parsed = AgentPreviewResultSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export class MongoWekiFlowStore implements WekiFlowStore {
  private readonly docs: ReturnType<typeof createDocumentsRepo>;
  private readonly jobs: ReturnType<typeof createJobsRepo>;
  private readonly usersRepo: ReturnType<typeof createUsersRepo>;

  constructor(
    private readonly db: Db,
    private readonly mainQueue: Queue,
    private readonly graphQueue: Queue,
  ) {
    this.docs = createDocumentsRepo(db);
    this.jobs = createJobsRepo(db);
    this.usersRepo = createUsersRepo(db);
  }

  /** 부트 시 소유자 계정을 멱등하게 보장한다(데모 사용자는 scripts/seed-wiki.ts에서 시드). */
  async seed(): Promise<void> {
    const env = loadEnv();
    await this.usersRepo.ensureOwner(env.ADMIN_EMAIL, env.ADMIN_PASSWORD);
  }

  private async enqueue(
    queue: Queue,
    type: JobType,
    documentId: string,
    overrides?: Parameters<Queue['add']>[2],
  ): Promise<JobRef> {
    const job = await queue.add(type, { documentId }, { ...defaultJobOptions(), ...overrides });
    return {
      id: String(job.id),
      type,
      documentId,
      createdAt: new Date().toISOString(),
    };
  }

  async tree(): Promise<TreeNode[]> {
    return this.docs.tree();
  }

  async getDocument(id: string): Promise<DocumentDTO | undefined> {
    return this.docs.getById(id);
  }

  async createDocument(input: {
    title: string;
    contentMarkdown?: string;
    parentId?: string | null;
  }): Promise<DocumentDTO> {
    return this.docs.createDocument(input);
  }

  async ingest(input: {
    title: string;
    contentMarkdown: string;
    parentId?: string | null;
  }): Promise<{ doc: DocumentDTO; job: JobRef }> {
    const doc = await this.docs.createDraft(input);
    const job = await this.enqueue(this.mainQueue, 'INGEST', doc.id);
    return { doc, job };
  }

  async agentPreview(input: { title: string; contentMarkdown: string }): Promise<{ jobId: string; documentId: string }> {
    const doc = await this.docs.createPreviewDraft(input);
    // Previews are interactive and ephemeral: the worker deletes the draft when the job settles, so a
    // retry would only re-run against a deleted document. Run a single attempt and let the user re-run.
    const job = await this.enqueue(this.mainQueue, 'PREVIEW', doc.id, { attempts: 1 });
    await this.jobs.recordLifecycle(
      job.id,
      {
        queue: 'main',
        type: 'PREVIEW',
        documentId: doc.id,
        title: doc.title,
        status: 'queued',
      },
      { insertOnly: true },
    );
    return { jobId: job.id, documentId: doc.id };
  }

  async getAgentPreview(jobId: string): Promise<AgentPreviewRun | undefined> {
    const [record, steps, job] = await Promise.all([
      this.jobs.getJobRecord(jobId),
      this.jobs.getAgentSteps(jobId),
      this.mainQueue.getJob(jobId),
    ]);
    const state = job ? await job.getState() : record?.status;
    // Prefer the live BullMQ return value while the job survives; fall back to the result persisted on
    // the jobs record so completed runs still resolve after the job is evicted (removeOnComplete).
    const result = parsePreviewResult(job?.returnvalue) ?? parsePreviewResult(record?.result);
    const status = normalizePreviewState(state);
    const documentId = record?.documentId || result?.documentId || '';
    if (!record && !job && steps.length === 0) return undefined;
    return {
      jobId,
      documentId,
      ...(record?.title ? { title: record.title } : {}),
      status,
      steps,
      ...(result ? { result } : {}),
      error: record?.error ?? job?.failedReason ?? null,
      ...(record?.createdAt ? { createdAt: record.createdAt } : {}),
      ...(record?.updatedAt ? { updatedAt: record.updatedAt } : {}),
    };
  }

  async listAgentPreviews(): Promise<AgentPreviewRun[]> {
    // Build the list purely from persisted records + a single batched steps query — no per-row BullMQ
    // round trips. Status/result are read from the jobs record the worker keeps up to date.
    const records = await this.jobs.listAgentPreviewJobs(30);
    const stepsByJob = await this.jobs.getAgentStepsBatch(records.map((record) => record.jobId));
    return records.map((record) => {
      const result = parsePreviewResult(record.result);
      return {
        jobId: record.jobId,
        documentId: record.documentId || result?.documentId || '',
        ...(record.title ? { title: record.title } : {}),
        status: normalizePreviewState(record.status),
        steps: stepsByJob.get(record.jobId) ?? [],
        ...(result ? { result } : {}),
        error: record.error ?? null,
        ...(record.createdAt ? { createdAt: record.createdAt } : {}),
        ...(record.updatedAt ? { updatedAt: record.updatedAt } : {}),
      };
    });
  }

  async reviews(): Promise<DocumentDTO[]> {
    return this.docs.reviews();
  }

  async approve(id: string, role: UserRole): Promise<ApproveResult> {
    if (!canApprove(role)) {
      return { ok: false, statusCode: 403, error: 'Forbidden' };
    }
    const doc = await this.docs.publish(id);
    if (!doc) {
      return { ok: false, statusCode: 404, error: 'Not found' };
    }
    const job = await this.enqueue(this.graphQueue, 'EXTRACT_TRIPLETS', id);
    return { ok: true, doc, job };
  }

  async reject(id: string): Promise<DocumentDTO | undefined> {
    return this.docs.reject(id);
  }

  async listKnowledge(q: KnowledgeQuery): Promise<KnowledgeItem[]> {
    const query = KnowledgeQuerySchema.parse(q);
    const rows = await this.dbCollection('documents').find({ 'wiki.id': { $exists: true } }).toArray();
    const items = rows.map((row) => row.wiki as KnowledgeItem);
    const needle = normalizeEntityName(query.q);
    return items
      .filter((item) => {
        const personOk = query.person === 'all' || item.authorName === query.person || item.department === query.person;
        const topicOk = query.topic === 'all' || item.category === query.topic;
        const tagOk = !query.tag || item.aiTags.includes(query.tag);
        const statusOk = query.status === 'all' || item.freshness === query.status;
        const searchOk = !needle || normalizeEntityName(`${item.title} ${item.summary} ${item.aiTags.join(' ')}`).includes(needle);
        return personOk && topicOk && tagOk && statusOk && searchOk;
      })
      .sort((a, b) => (query.sort === 'alpha' ? a.title.localeCompare(b.title, 'ko') : query.sort === 'recent' ? b.modCount - a.modCount : b.usageCount - a.usageCount));
  }

  async getKnowledge(id: string): Promise<KnowledgeItem | null> {
    const row = await this.dbCollection('documents').findOne({ 'wiki.id': id });
    return row?.wiki ? (row.wiki as KnowledgeItem) : null;
  }

  async patchKnowledge(id: string, body: { contentMarkdown: string }): Promise<KnowledgeItem | null> {
    const current = await this.getKnowledge(id);
    if (!current) return null;
    const updated: KnowledgeItem = {
      ...current,
      contentMarkdown: body.contentMarkdown,
      modCount: current.modCount + 1,
      updatedAtLabel: '방금 전',
      lastChange: { label: '수동 편집', at: new Date().toISOString(), by: '이지수', source: '웹 편집' },
    };
    await this.dbCollection('documents').updateOne(
      { 'wiki.id': id },
      { $set: { wiki: updated, contentMarkdown: updated.contentMarkdown, updatedAt: new Date() }, $inc: { version: 1 } },
    );
    return updated;
  }

  async listTopics(): Promise<Topic[]> {
    const topics = (await this.dbCollection('topics').find({}).toArray()).map((row) => row as unknown as Topic);
    const items = await this.listKnowledge({ person: 'all', topic: 'all', tag: null, status: 'all', q: '', sort: 'uses' });
    return topics.map((topic) => ({ ...topic, count: items.filter((item) => item.category === topic.name).length }));
  }

  async createTopic(name: string): Promise<Topic> {
    const topic: Topic = { id: `topic-user-${Date.now()}`, name, source: 'user', isUnclassified: false, count: 0 };
    await this.dbCollection('topics').updateOne({ name }, { $setOnInsert: { ...topic, createdAt: new Date() } }, { upsert: true });
    const row = await this.dbCollection('topics').findOne({ name });
    return row as unknown as Topic;
  }

  async deleteTopic(id: string): Promise<{ ok: boolean; reassigned: number; statusCode?: number; error?: string }> {
    const topic = (await this.dbCollection('topics').findOne({ id })) as unknown as Topic | null;
    if (!topic) return { ok: false, reassigned: 0, statusCode: 404, error: 'Not found' };
    if (topic.source === 'system') return { ok: false, reassigned: 0, statusCode: 400, error: 'System topic cannot be deleted' };
    const result = await this.dbCollection('documents').updateMany({ 'wiki.category': topic.name }, { $set: { 'wiki.category': '미분류' } });
    await this.dbCollection('topics').deleteOne({ id });
    return { ok: true, reassigned: result.modifiedCount };
  }

  async listAiTagSuggestions(): Promise<AiTagSuggestion[]> {
    return (await this.dbCollection('ai_tag_suggestions').find({ status: 'pending' }).toArray()) as unknown as AiTagSuggestion[];
  }

  async resolveAiTagSuggestion(id: string, action: 'approve' | 'reject'): Promise<{ ok: boolean }> {
    const suggestion = (await this.dbCollection('ai_tag_suggestions').findOne({ id })) as unknown as AiTagSuggestion | null;
    if (!suggestion) return { ok: false };
    if (action === 'approve') await this.dbCollection('documents').updateOne({ 'wiki.id': suggestion.itemId }, { $addToSet: { 'wiki.aiTags': suggestion.tag } });
    await this.dbCollection('ai_tag_suggestions').updateOne({ id }, { $set: { status: action === 'approve' ? 'approved' : 'rejected' } });
    return { ok: true };
  }

  async listRichReviews(): Promise<ReviewItem[]> {
    return (await this.dbCollection('review_items').find({ resolved: false }).toArray()) as unknown as ReviewItem[];
  }

  async resolveReview(id: string, action: 'approve' | 'reject', role: UserRole): Promise<ApproveResult> {
    // 승인은 승인(APPROVER) 이상, 반려는 검토(REVIEWER) 이상.
    if (!(action === 'approve' ? canApprove(role) : canReview(role))) {
      return { ok: false, statusCode: 403, error: 'Forbidden' };
    }
    const review = (await this.dbCollection('review_items').findOne({ id })) as unknown as ReviewItem | null;
    if (!review) return { ok: false, statusCode: 404, error: 'Not found' };
    await this.dbCollection('review_items').updateOne({ id }, { $set: { resolved: true } });
    if (action === 'approve' && review.documentId) {
      const item = await this.getKnowledge(review.documentId);
      if (item) await this.patchKnowledge(item.id, { contentMarkdown: `${item.contentMarkdown}\n\n${review.newContent}` });
    }
    const doc = review.documentId ? await this.documentByWikiId(review.documentId) : undefined;
    if (!doc) return { ok: false, statusCode: 404, error: 'Target document not found' };
    return { ok: true, doc, job: await this.enqueue(this.graphQueue, 'EXTRACT_TRIPLETS', doc.id) };
  }

  async listMultiSource(): Promise<MultiSourceGroup[]> {
    return (await this.dbCollection('multi_source_groups').find({ resolved: false }).toArray()) as unknown as MultiSourceGroup[];
  }

  async resolveMultiSource(id: string, body: MsResolveBody, role: UserRole): Promise<ApproveResult> {
    if (!canApprove(role)) return { ok: false, statusCode: 403, error: 'Forbidden' };
    const group = (await this.dbCollection('multi_source_groups').findOne({ id })) as unknown as MultiSourceGroup | null;
    if (!group) return { ok: false, statusCode: 404, error: 'Not found' };
    if (group.multiSourceType === 'C') return { ok: false, statusCode: 409, error: 'Conflicting multi-source group requires confirmation' };
    if (group.multiSourceType === 'B' && !body.selectedVersion) return { ok: false, statusCode: 400, error: 'selectedVersion is required' };
    for (const targetId of body.targetIds) {
      const item = await this.getKnowledge(targetId);
      if (item) await this.patchKnowledge(item.id, { contentMarkdown: `${item.contentMarkdown}\n\n${body.content ?? group.resolvedContent ?? ''}` });
    }
    await this.dbCollection('multi_source_groups').updateOne({ id }, { $set: { resolved: true } });
    const doc = await this.documentByWikiId(body.targetIds[0] ?? '');
    if (!doc) return { ok: false, statusCode: 404, error: 'Target document not found' };
    return { ok: true, doc, job: await this.enqueue(this.graphQueue, 'EXTRACT_TRIPLETS', doc.id) };
  }

  async splitMultiSource(id: string): Promise<{ ok: boolean }> {
    await this.dbCollection('multi_source_groups').updateOne({ id }, { $set: { resolved: true } });
    return { ok: true };
  }

  async requestConfirmMultiSource(id: string): Promise<{ ok: boolean }> {
    await this.dbCollection('multi_source_groups').updateOne({ id }, { $set: { resolved: true } });
    return { ok: true };
  }

  async homeDigest(): Promise<DailyDigest> {
    return createSeedDigest((await this.listRichReviews()).length + (await this.listMultiSource()).length);
  }

  async listActivity(limit = 5): Promise<ActivityEntry[]> {
    return (await this.dbCollection('activity_log').find({}).limit(limit).toArray()) as unknown as ActivityEntry[];
  }

  async treeCategories(): Promise<TreeCategory[]> {
    return groupKnowledgeByCategory(await this.listKnowledge({ person: 'all', topic: 'all', tag: null, status: 'all', q: '', sort: 'alpha' }), await this.listTopics());
  }

  private dbCollection(name: string) {
    return this.db.collection(name);
  }

  private async documentByWikiId(id: string): Promise<DocumentDTO | undefined> {
    const row = await this.db.collection('documents').findOne({ 'wiki.id': id });
    return row ? toDocumentDTO(row) : undefined;
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.usersRepo.findByEmailWithPassword(email);
    if (!user || user.password !== password) {
      return { ok: false, statusCode: 401, error: '이메일 또는 비밀번호가 올바르지 않습니다.' };
    }
    const token = await this.usersRepo.createSession(user.id);
    const { password: _password, ...dto } = user;
    return { ok: true, token, user: dto };
  }

  async me(token: string): Promise<User | undefined> {
    const userId = await this.usersRepo.resolveSession(token);
    if (!userId) return undefined;
    return this.usersRepo.getById(userId);
  }

  async logout(token: string): Promise<void> {
    await this.usersRepo.deleteSession(token);
  }

  async listUsers(): Promise<User[]> {
    return this.usersRepo.list();
  }

  async createUser(body: CreateUserBody): Promise<UserResult> {
    const existing = await this.usersRepo.findByEmailWithPassword(body.email);
    if (existing) return { ok: false, statusCode: 409, error: '이미 존재하는 이메일입니다.' };
    // PoC: 비밀번호는 이메일과 동일하게 발급.
    const user = await this.usersRepo.create({ email: body.email, name: body.name, role: body.role, password: body.email });
    return { ok: true, user };
  }

  async updateUserRole(id: string, role: UserRole): Promise<UserResult> {
    const current = await this.usersRepo.getById(id);
    if (!current) return { ok: false, statusCode: 404, error: '사용자를 찾을 수 없습니다.' };
    if (current.role === 'OWNER' && role !== 'OWNER' && (await this.usersRepo.countByRole('OWNER')) <= 1) {
      return { ok: false, statusCode: 400, error: '마지막 소유자의 권한은 변경할 수 없습니다.' };
    }
    const updated = await this.usersRepo.updateRole(id, role);
    if (!updated) return { ok: false, statusCode: 404, error: '사용자를 찾을 수 없습니다.' };
    return { ok: true, user: updated };
  }

  async deleteUser(id: string): Promise<OkResult> {
    const current = await this.usersRepo.getById(id);
    if (!current) return { ok: false, statusCode: 404, error: '사용자를 찾을 수 없습니다.' };
    if (current.role === 'OWNER' && (await this.usersRepo.countByRole('OWNER')) <= 1) {
      return { ok: false, statusCode: 400, error: '마지막 소유자는 삭제할 수 없습니다.' };
    }
    await this.usersRepo.remove(id);
    return { ok: true };
  }
}
