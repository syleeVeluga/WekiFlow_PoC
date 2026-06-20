import { ObjectId, type Db, type Document, type WithId } from 'mongodb';
import {
  CreateKnowledgeCandidateSchema,
  KnowledgeCandidateSchema,
  KnowledgeCandidateListQuerySchema,
  type CandidateStatus,
  type CreateKnowledgeCandidate,
  type KnowledgeCandidate,
  type KnowledgeCandidateListQuery,
  canTransitionCandidate,
  defaultCandidateStatusForProvenance,
} from '@wf/shared';

function toObjectId(id: string): ObjectId | null {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(0).toISOString();
}

function toCandidate(row: WithId<Document>): KnowledgeCandidate {
  return KnowledgeCandidateSchema.parse({
    id: row._id.toString(),
    title: row.title,
    summary: row.summary,
    bodyMarkdown: row.bodyMarkdown,
    status: row.status,
    riskFactors: row.riskFactors,
    provenance: row.provenance,
    linkedDocId: row.linkedDocId == null ? null : String(row.linkedDocId),
    conflictWith: row.conflictWith,
    workspaceId: row.workspaceId,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  });
}

export function createCandidateRepository(db: Db) {
  const collection = db.collection('knowledge_candidates');

  return {
    async createCandidate(input: CreateKnowledgeCandidate): Promise<KnowledgeCandidate> {
      const parsed = CreateKnowledgeCandidateSchema.parse(input);
      const now = new Date();
      const doc = {
        _id: new ObjectId(),
        title: parsed.title,
        summary: parsed.summary,
        bodyMarkdown: parsed.bodyMarkdown,
        status: parsed.status ?? defaultCandidateStatusForProvenance(parsed.provenance),
        riskFactors: parsed.riskFactors,
        provenance: parsed.provenance,
        linkedDocId: parsed.linkedDocId ?? null,
        conflictWith: parsed.conflictWith,
        ...(parsed.workspaceId ? { workspaceId: parsed.workspaceId } : {}),
        createdAt: now,
        updatedAt: now,
      };
      await collection.insertOne(doc);
      return toCandidate(doc);
    },

    async listCandidates(filter: KnowledgeCandidateListQuery = {}): Promise<KnowledgeCandidate[]> {
      const parsed = KnowledgeCandidateListQuerySchema.parse(filter);
      const query: Document = {};
      if (parsed.status) query.status = parsed.status;
      if (parsed.riskFactor) query.riskFactors = parsed.riskFactor;
      if (parsed.provenanceKind) query['provenance.kind'] = parsed.provenanceKind;
      if (parsed.workspaceId) query.workspaceId = parsed.workspaceId;
      const rows = await collection.find(query).sort({ createdAt: -1 }).toArray();
      return rows.map(toCandidate);
    },

    async getCandidate(id: string): Promise<KnowledgeCandidate | undefined> {
      const oid = toObjectId(id);
      if (!oid) return undefined;
      const row = await collection.findOne({ _id: oid });
      return row ? toCandidate(row) : undefined;
    },

    async updateCandidateStatus(id: string, status: CandidateStatus): Promise<KnowledgeCandidate | undefined> {
      const oid = toObjectId(id);
      if (!oid) return undefined;
      const current = await collection.findOne({ _id: oid });
      if (!current) return undefined;
      const currentStatus = String(current.status) as CandidateStatus;
      if (!canTransitionCandidate(currentStatus, status)) {
        throw new Error(`Invalid candidate status transition: ${currentStatus} -> ${status}`);
      }
      const updated = await collection.findOneAndUpdate(
        { _id: oid },
        { $set: { status, updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
      return updated ? toCandidate(updated) : undefined;
    },
  };
}
