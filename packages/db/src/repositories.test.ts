import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { createDocumentsRepo } from './repositories.js';

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
});
