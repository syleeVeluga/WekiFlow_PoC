import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { createCandidateRepository, createDocumentsRepo, createRuntimeConfigRepo, createUsersRepo, getDocumentConnections } from './index.js';

describe('createDocumentsRepo', () => {
  it('generates distinct slugs for documents with the same title', async () => {
    const documents: Array<Record<string, unknown> & { _id: ObjectId }> = [];
    const repo = createDocumentsRepo({
      collection() {
        return {
          async insertOne(doc: Record<string, unknown> & { _id: ObjectId }) {
            documents.push(doc);
            return { insertedId: doc._id };
          },
          async findOne(query: { _id: ObjectId }) {
            return documents.find((doc) => doc._id.equals(query._id));
          },
        };
      },
    } as never);

    const first = await repo.createDocument({ title: '연차 규정' });
    const second = await repo.createDocument({ title: '연차 규정' });

    expect(first.slug).toMatch(/^연차-규정-/);
    expect(second.slug).toMatch(/^연차-규정-/);
    expect(first.slug).not.toBe(second.slug);
  });

  it('only permanently deletes documents that are already trashed', async () => {
    const activeId = new ObjectId();
    const trashedId = new ObjectId();
    const documents = [
      { _id: activeId, trashed: false },
      { _id: trashedId, trashed: true },
    ];
    const calls: string[] = [];
    const repo = createDocumentsRepo({
      collection(name: string) {
        if (name === 'documents') {
          return {
            async deleteOne(query: { _id: ObjectId; trashed: boolean }) {
              calls.push(`documents:${query.trashed}`);
              const index = documents.findIndex((doc) => doc._id.equals(query._id) && doc.trashed === query.trashed);
              if (index === -1) return { deletedCount: 0 };
              documents.splice(index, 1);
              return { deletedCount: 1 };
            },
          };
        }
        if (name === 'chunks') {
          return {
            async deleteMany() {
              calls.push('chunks:delete');
              return { deletedCount: 1 };
            },
          };
        }
        if (name === 'kg_edges') {
          return {
            async updateMany() {
              calls.push('edges:update');
              return { modifiedCount: 1 };
            },
            async deleteMany() {
              calls.push('edges:delete');
              return { deletedCount: 1 };
            },
          };
        }
        throw new Error(`Unexpected collection ${name}`);
      },
    } as never);

    await expect(repo.purge(activeId.toHexString())).resolves.toBe(false);
    expect(documents.some((doc) => doc._id.equals(activeId))).toBe(true);
    expect(calls).toEqual(['documents:true']);

    calls.length = 0;
    await expect(repo.purge(trashedId.toHexString())).resolves.toBe(true);
    expect(documents.some((doc) => doc._id.equals(trashedId))).toBe(false);
    expect(calls).toEqual(['documents:true', 'chunks:delete', 'edges:update', 'edges:delete']);
  });

  it('lists known tags from document aiTags and topic names, deduped and trimmed', async () => {
    const calls: Array<{ field: string; query?: unknown }> = [];
    const repo = createDocumentsRepo({
      collection(name: string) {
        if (name === 'documents') {
          return {
            async distinct(field: string, query: unknown) {
              calls.push({ field, query });
              return [' 복지 ', '인사', '복지'];
            },
          };
        }
        if (name === 'chunks') return {};
        if (name === 'topics') {
          return {
            async distinct(field: string, query: unknown) {
              calls.push({ field, query });
              return ['인사', '계획'];
            },
          };
        }
        throw new Error(`Unexpected collection ${name}`);
      },
    } as never);

    const tags = await repo.listKnownTags();

    // Deduped (복지 trimmed-equal, 인사 across both sources) and order-preserving (docs first, topics next).
    expect(tags).toEqual(['복지', '인사', '계획']);
    // aiTags distinct excludes trashed docs; topic names exclude the system unclassified topic.
    expect(calls).toContainEqual({ field: 'wiki.aiTags', query: { trashed: { $ne: true } } });
    expect(calls).toContainEqual({ field: 'name', query: { isUnclassified: { $ne: true } } });
  });

  it('unions cleaned tags into wiki.aiTags via $addToSet and skips empty writes', async () => {
    const id = new ObjectId();
    const updates: Array<{ query: unknown; update: Record<string, unknown> }> = [];
    const repo = createDocumentsRepo({
      collection(name: string) {
        if (name === 'documents') {
          return {
            async updateOne(query: unknown, update: Record<string, unknown>) {
              updates.push({ query, update });
              return { matchedCount: 1 };
            },
          };
        }
        if (name === 'chunks') return {};
        throw new Error(`Unexpected collection ${name}`);
      },
    } as never);

    await repo.addWikiTags(id.toHexString(), [' 복지 ', '복지', '', '인사']);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.update.$addToSet).toEqual({ 'wiki.aiTags': { $each: ['복지', '인사'] } });

    // A set that cleans down to nothing must not issue a write.
    await repo.addWikiTags(id.toHexString(), ['  ', '']);
    expect(updates).toHaveLength(1);

    // An unparseable id must not issue a write.
    await repo.addWikiTags('not-an-object-id', ['복지']);
    expect(updates).toHaveLength(1);
  });
});

describe('createUsersRepo', () => {
  it('persists and returns the orthogonal superadmin flag', async () => {
    const rows: Array<Record<string, unknown> & { _id: ObjectId }> = [];
    const sessions: Array<Record<string, unknown>> = [];
    const db = {
      collection(name: string) {
        if (name === 'users') {
          return {
            async updateOne(query: { email: string }, update: { $setOnInsert: Record<string, unknown> }) {
              if (!rows.some((row) => row.email === query.email)) {
                rows.push({ _id: new ObjectId(), ...update.$setOnInsert });
              }
              return { upsertedCount: 1 };
            },
            find() {
              return {
                sort() {
                  return {
                    async toArray() {
                      return rows;
                    },
                  };
                },
              };
            },
            async findOne(query: Record<string, unknown>) {
              if (query.email) return rows.find((row) => row.email === query.email) ?? null;
              if (query._id instanceof ObjectId) return rows.find((row) => row._id.equals(query._id as ObjectId)) ?? null;
              return null;
            },
            async insertOne(doc: Record<string, unknown> & { _id: ObjectId }) {
              rows.push(doc);
              return { insertedId: doc._id };
            },
            async findOneAndUpdate(query: { _id: ObjectId }, update: { $set: Record<string, unknown> }) {
              const row = rows.find((entry) => entry._id.equals(query._id));
              if (!row) return null;
              Object.assign(row, update.$set);
              return row;
            },
            async countDocuments(query: { role: string }) {
              return rows.filter((row) => row.role === query.role).length;
            },
          };
        }
        if (name === 'sessions') {
          return {
            async insertOne(doc: Record<string, unknown>) {
              sessions.push(doc);
              return { insertedId: doc.token };
            },
            async findOne(query: { token: string }) {
              return sessions.find((row) => row.token === query.token) ?? null;
            },
            async deleteOne() {
              return { deletedCount: 1 };
            },
            async deleteMany() {
              return { deletedCount: 1 };
            },
          };
        }
        throw new Error(`Unexpected collection ${name}`);
      },
    } as never;
    const repo = createUsersRepo(db);

    await repo.ensureOwner('owner@example.com', 'pw');
    const owner = await repo.findByEmailWithPassword('owner@example.com');
    expect(owner).toMatchObject({ role: 'OWNER', isSuperAdmin: true });

    const created = await repo.create({
      email: 'dev@example.com',
      name: 'Dev',
      role: 'EDITOR',
      isSuperAdmin: true,
      password: 'dev@example.com',
    });
    expect(created).toMatchObject({ role: 'EDITOR', isSuperAdmin: true });

    const updated = await repo.updateUser(created.id, { role: 'EDITOR', isSuperAdmin: false });
    expect(updated).toMatchObject({ role: 'EDITOR', isSuperAdmin: false });
    expect((await repo.list()).find((user) => user.id === created.id)).toMatchObject({ isSuperAdmin: false });
  });
});

describe('createCandidateRepository', () => {
  it('creates, filters, and enforces candidate status transitions', async () => {
    const rows: Array<Record<string, unknown> & { _id: ObjectId }> = [];
    const queries: unknown[] = [];
    const repo = createCandidateRepository({
      collection(name: string) {
        if (name !== 'knowledge_candidates') throw new Error(`Unexpected collection ${name}`);
        return {
          async insertOne(doc: Record<string, unknown> & { _id: ObjectId }) {
            rows.push(doc);
            return { insertedId: doc._id };
          },
          find(query: unknown) {
            queries.push(query);
            return {
              sort() {
                return {
                  async toArray() {
                    return rows;
                  },
                };
              },
            };
          },
          async findOne(query: { _id: ObjectId }) {
            return rows.find((row) => row._id.equals(query._id)) ?? null;
          },
          async findOneAndUpdate(query: { _id: ObjectId }, update: { $set: Record<string, unknown> }) {
            const row = rows.find((entry) => entry._id.equals(query._id));
            if (!row) return null;
            for (const [key, value] of Object.entries(update.$set)) {
              if (key === 'provenance.needsSource') {
                row.provenance = { ...(row.provenance as Record<string, unknown>), needsSource: value };
              } else {
                row[key] = value;
              }
            }
            return row;
          },
        };
      },
    } as never);

    const created = await repo.createCandidate({
      title: 'Conversation candidate',
      provenance: { kind: 'conversation', ref: 'chat://1' },
      riskFactors: ['no_source'],
      workspaceId: 'workspace-a',
    });

    expect(created.status).toBe('NEEDS_CHECK');
    expect(created.provenance).toMatchObject({ needsSource: true });
    await expect(repo.listCandidates({ riskFactor: 'no_source', provenanceKind: 'conversation', workspaceId: 'workspace-a' })).resolves.toHaveLength(1);
    expect(queries[0]).toMatchObject({
      riskFactors: 'no_source',
      'provenance.kind': 'conversation',
      workspaceId: 'workspace-a',
    });

    await expect(
      repo.updateCandidateStatus(created.id, {
        status: 'SOURCE_VERIFIED',
        linkedDocId: 'doc-source-1',
        provenanceNeedsSource: false,
        removeRiskFactor: 'no_source',
      }),
    ).resolves.toMatchObject({
      status: 'SOURCE_VERIFIED',
      linkedDocId: 'doc-source-1',
      provenance: { needsSource: false },
      riskFactors: [],
    });
    await expect(repo.updateCandidateStatus(created.id, { status: 'AI_ORGANIZED' })).rejects.toThrow('Invalid candidate status transition');
  });
});

describe('createRuntimeConfigRepo', () => {
  it('round-trips partial overrides and restores null patch values', async () => {
    let row: (Record<string, unknown> & { _id: string }) | null = null;
    const repo = createRuntimeConfigRepo({
      collection(name: string) {
        if (name !== 'app_config') throw new Error(`Unexpected collection ${name}`);
        return {
          async findOne(query: { _id: string }) {
            return row && row._id === query._id ? row : null;
          },
          async updateOne(query: { _id: string }, update: { $set: Record<string, unknown>; $setOnInsert?: Record<string, unknown> }) {
            row = {
              ...(row ?? { _id: query._id, ...(update.$setOnInsert ?? {}) }),
              ...update.$set,
            };
            return { upsertedCount: row._id === query._id ? 1 : 0 };
          },
        };
      },
    } as never);

    expect(await repo.get()).toMatchObject({ prompts: {}, agentParams: {}, models: {}, policy: null });
    await repo.update({
      prompts: { main: 'custom main' },
      agentParams: { vectorK: 10, graphMaxDepth: 3 },
      models: { agentModel: 'gpt-custom' },
    });
    expect(await repo.get()).toMatchObject({
      prompts: { main: 'custom main' },
      agentParams: { vectorK: 10, graphMaxDepth: 3 },
      models: { agentModel: 'gpt-custom' },
    });

    const restored = await repo.update({
      prompts: { main: null },
      agentParams: { vectorK: null },
      models: { agentModel: null },
    });
    expect(restored).toMatchObject({
      prompts: {},
      agentParams: { graphMaxDepth: 3 },
      models: {},
      policy: null,
    });
  });
});

describe('getDocumentConnections', () => {
  it('surfaces related documents from edges that also include the current document', async () => {
    const ownDocId = new ObjectId();
    const relatedDocId = new ObjectId();
    const subjectId = new ObjectId();
    const objectId = new ObjectId();
    const edge = {
      subjectId,
      predicate: 'receives',
      objectId,
      strength: 0.9,
      sourceDocIds: [ownDocId, relatedDocId],
    };

    const db = {
      collection(name: string) {
        if (name === 'kg_edges') {
          return {
            find(query: { sourceDocIds?: ObjectId | { $ne: ObjectId }; $or?: Array<Record<string, { $in: ObjectId[] }>> }) {
              return {
                async toArray() {
                  if (query.sourceDocIds instanceof ObjectId) {
                    return edge.sourceDocIds.some((sourceDocId) => sourceDocId.equals(query.sourceDocIds as ObjectId)) ? [edge] : [];
                  }
                  const sourceDocFilter = query.sourceDocIds;
                  if (sourceDocFilter && '$ne' in sourceDocFilter) {
                    return edge.sourceDocIds.some((sourceDocId) => sourceDocId.equals(sourceDocFilter.$ne)) ? [] : [edge];
                  }
                  if (query.$or) {
                    return query.$or.some((clause) => {
                      const subjectIds = clause.subjectId?.$in ?? [];
                      const objectIds = clause.objectId?.$in ?? [];
                      return subjectIds.some((id) => id.equals(edge.subjectId)) || objectIds.some((id) => id.equals(edge.objectId));
                    })
                      ? [edge]
                      : [];
                  }
                  return [];
                },
              };
            },
          };
        }
        if (name === 'kg_nodes') {
          return {
            find() {
              return {
                async toArray() {
                  return [
                    { _id: subjectId, name: 'New Hire' },
                    { _id: objectId, name: 'Annual Leave' },
                  ];
                },
              };
            },
          };
        }
        if (name === 'documents') {
          return {
            find(query: { _id: { $in: ObjectId[] } }) {
              return {
                async toArray() {
                  return query._id.$in.some((id) => id.equals(relatedDocId)) ? [{ _id: relatedDocId, title: 'Related policy' }] : [];
                },
              };
            },
          };
        }
        throw new Error(`Unexpected collection ${name}`);
      },
    } as never;

    const result = await getDocumentConnections(db, ownDocId.toHexString());

    expect(result.facts).toEqual([
      { subject: 'New Hire', predicate: 'receives', object: 'Annual Leave', strength: 0.9 },
    ]);
    expect(result.relatedDocs).toEqual([
      {
        documentId: relatedDocId.toHexString(),
        title: 'Related policy',
        sharedEntities: ['New Hire', 'Annual Leave'],
        via: [
          { entity: 'New Hire', predicate: 'receives' },
          { entity: 'Annual Leave', predicate: 'receives' },
        ],
      },
    ]);
    expect(result.relatedDocs.every((doc) => doc.documentId !== ownDocId.toHexString())).toBe(true);
  });
});
