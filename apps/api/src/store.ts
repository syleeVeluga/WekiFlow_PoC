import { InMemoryQueue } from '@wf/queue';
import { type DocumentDTO, type UserRole, canApprove } from '@wf/shared';

export class InMemoryWekiFlowStore {
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

  tree() {
    return [...this.documents.values()].map((doc) => ({
      id: doc.id,
      parentId: doc.parentId,
      title: doc.title,
      slug: doc.slug,
      isFolder: doc.isFolder,
      status: doc.status,
    }));
  }

  getDocument(id: string) {
    return this.documents.get(id);
  }

  ingest(input: { title: string; contentMarkdown: string; parentId?: string | null }) {
    const now = new Date().toISOString();
    const id = `doc-${++this.sequence + 1}`;
    const doc: DocumentDTO = {
      id,
      slug: input.title.toLowerCase().replace(/\s+/g, '-'),
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
    };
    this.documents.set(id, doc);
    const job = this.mainQueue.add('INGEST', { documentId: id });
    this.applyStubMainWorker(id);
    return { doc: this.documents.get(id), job };
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

  reviews() {
    return [...this.documents.values()].filter((doc) => doc.status === 'REVIEW');
  }

  approve(id: string, role: UserRole) {
    if (!canApprove(role)) {
      return { ok: false as const, statusCode: 403, error: 'Forbidden' };
    }
    const doc = this.documents.get(id);
    if (!doc) {
      return { ok: false as const, statusCode: 404, error: 'Not found' };
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
    return { ok: true as const, doc: published, job };
  }

  reject(id: string) {
    const doc = this.documents.get(id);
    if (!doc) return undefined;
    const updated: DocumentDTO = { ...doc, status: 'DRAFT', draftMarkdown: null };
    this.documents.set(id, updated);
    return updated;
  }
}
