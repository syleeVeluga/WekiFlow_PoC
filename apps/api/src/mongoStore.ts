import type { Queue } from 'bullmq';
import type { Db } from 'mongodb';
import { createDocumentsRepo, toDocumentDTO } from '@wf/db';
import { defaultJobOptions } from '@wf/queue';
import {
  KnowledgeQuerySchema,
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
  type UserRole,
  canApprove,
  createSeedDigest,
  groupKnowledgeByCategory,
  normalizeEntityName,
} from '@wf/shared';
import type { ApproveResult, WekiFlowStore } from './store.js';

export class MongoWekiFlowStore implements WekiFlowStore {
  private readonly docs: ReturnType<typeof createDocumentsRepo>;

  constructor(
    private readonly db: Db,
    private readonly mainQueue: Queue,
    private readonly graphQueue: Queue,
  ) {
    this.docs = createDocumentsRepo(db);
  }

  private async enqueue(queue: Queue, type: JobType, documentId: string): Promise<JobRef> {
    const job = await queue.add(type, { documentId }, defaultJobOptions());
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
    if (!canApprove(role)) return { ok: false, statusCode: 403, error: 'Forbidden' };
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
}
