import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { createDocumentsRepo, getDocumentConnections } from './repositories.js';

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
