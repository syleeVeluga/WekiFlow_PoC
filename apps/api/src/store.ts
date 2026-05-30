import { InMemoryQueue } from '@wf/queue';
import {
  type DocumentDTO,
  type JobRef,
  type TreeNode,
  type UserRole,
  canApprove,
} from '@wf/shared';

export type ApproveResult =
  | { ok: true; doc: DocumentDTO; job: JobRef }
  | { ok: false; statusCode: number; error: string };

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
}

export class InMemoryWekiFlowStore implements WekiFlowStore {
  readonly documents = new Map<string, DocumentDTO>();
  readonly mainQueue = new InMemoryQueue();
  readonly graphQueue = new InMemoryQueue();

  private sequence = 0;

  seed() {
    if (this.documents.size > 0) return;
    const now = new Date().toISOString();
    const doc: DocumentDTO = {
      id: 'doc-1',
      slug: 'hr/annual-leave-policy',
      title: '연차 휴가 규정',
      parentId: null,
      isFolder: false,
      status: 'PUBLISHED',
      contentMarkdown: '# 연차 휴가 규정\n\n기존 승인 문서입니다.',
      draftMarkdown: null,
      version: 1,
      sourceRefs: [],
      createdAt: now,
      updatedAt: now,
    };
    this.documents.set(doc.id, doc);
  }

  async tree(): Promise<TreeNode[]> {
    return [...this.documents.values()].map((doc) => ({
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
}
