import type { Queue } from 'bullmq';
import type { Db } from 'mongodb';
import { createDocumentsRepo } from '@wf/db';
import { defaultJobOptions } from '@wf/queue';
import {
  type DocumentDTO,
  type JobRef,
  type JobType,
  type TreeNode,
  type UserRole,
  canApprove,
} from '@wf/shared';
import type { ApproveResult, WekiFlowStore } from './store.js';

export class MongoWekiFlowStore implements WekiFlowStore {
  private readonly docs: ReturnType<typeof createDocumentsRepo>;

  constructor(
    db: Db,
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
}
