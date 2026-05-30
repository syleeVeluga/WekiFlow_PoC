import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { runGraphPipeline } from './pipeline.js';

type Row = Record<string, unknown> & { _id: ObjectId };

function valueEquals(left: unknown, right: unknown): boolean {
  if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
  if (left instanceof ObjectId || right instanceof ObjectId) return String(left) === String(right);
  if (typeof left === 'object' && typeof right === 'object' && left && right) {
    return JSON.stringify(left, (_key, value) => (value instanceof ObjectId ? value.toHexString() : value)) ===
      JSON.stringify(right, (_key, value) => (value instanceof ObjectId ? value.toHexString() : value));
  }
  return left === right;
}

function matches(row: Row, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([key, value]) => valueEquals(row[key], value));
}

function applyUpdate(row: Row, update: Record<string, unknown>, inserting: boolean) {
  if (inserting && update.$setOnInsert) Object.assign(row, update.$setOnInsert);
  if (update.$set) Object.assign(row, update.$set);
  if (update.$max) {
    for (const [key, value] of Object.entries(update.$max as Record<string, number>)) {
      row[key] = Math.max(Number(row[key] ?? Number.NEGATIVE_INFINITY), value);
    }
  }
  if (update.$addToSet) {
    for (const [key, value] of Object.entries(update.$addToSet as Record<string, unknown>)) {
      const values = Array.isArray(row[key]) ? (row[key] as unknown[]) : [];
      if (!values.some((existing) => valueEquals(existing, value))) values.push(value);
      row[key] = values;
    }
  }
}

function createMemoryDb(seed: Record<string, Row[]> = {}) {
  const collections = new Map<string, Row[]>();
  for (const [name, rows] of Object.entries(seed)) collections.set(name, rows);

  return {
    rows(name: string) {
      return collections.get(name) ?? [];
    },
    collection(name: string) {
      if (!collections.has(name)) collections.set(name, []);
      const rows = collections.get(name)!;
      return {
        async findOne(query: Record<string, unknown>) {
          return rows.find((row) => matches(row, query)) ?? null;
        },
        async findOneAndUpdate(
          query: Record<string, unknown>,
          update: Record<string, unknown>,
          options?: { upsert?: boolean },
        ) {
          let row = rows.find((candidate) => matches(candidate, query));
          const inserting = !row;
          if (!row) {
            if (!options?.upsert) return null;
            row = { _id: new ObjectId(), ...query };
            rows.push(row);
          }
          applyUpdate(row, update, inserting);
          return row;
        },
        async updateOne(query: Record<string, unknown>, update: Record<string, unknown>, options?: { upsert?: boolean }) {
          let row = rows.find((candidate) => matches(candidate, query));
          const inserting = !row;
          if (!row) {
            if (!options?.upsert) return { matchedCount: 0, upsertedCount: 0 };
            row = { _id: new ObjectId(), ...query };
            rows.push(row);
          }
          applyUpdate(row, update, inserting);
          return { matchedCount: inserting ? 0 : 1, upsertedCount: inserting ? 1 : 0 };
        },
      };
    },
  };
}

describe('runGraphPipeline', () => {
  it('extracts, upserts normalized graph rows, and marks the document indexed', async () => {
    const documentId = new ObjectId();
    const db = createMemoryDb({
      documents: [
        {
          _id: documentId,
          slug: 'policy',
          title: 'Policy',
          parentId: null,
          isFolder: false,
          status: 'PUBLISHED',
          contentMarkdown: '# A\nNew hires receive 15 annual leave days.\n\n# B\nNew hires receive 15 annual leave days.',
          draftMarkdown: null,
          version: 1,
          sourceRefs: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
    const steps: Array<{ tool: string; args: unknown; result?: unknown }> = [];

    const result = await runGraphPipeline(documentId.toHexString(), {
      db: db as never,
      extractTriplets: async (chunk) => ({
        triplets: [
          {
            subject: 'New Hire',
            predicate: 'receives',
            object: 'Annual Leave 15 Days',
            subjectType: 'PERSON',
            objectType: 'REGULATION',
            strength: chunk.chunkIndex === 0 ? 0.4 : 0.9,
          },
        ],
      }),
      recordStep: (step) => {
        steps.push(step);
      },
    });

    expect(result).toEqual({
      documentId: documentId.toHexString(),
      status: 'GRAPH_INDEXED',
      chunkCount: 2,
      tripletCount: 1,
    });
    expect(db.rows('documents')[0]!.status).toBe('GRAPH_INDEXED');
    expect(db.rows('kg_nodes')).toHaveLength(2);
    expect(db.rows('kg_nodes').map((node) => node.normalizedName).sort()).toEqual([
      'annualleave15days',
      'newhire',
    ]);
    expect(db.rows('kg_edges')).toHaveLength(1);
    expect(db.rows('kg_edges')[0]!.strength).toBe(0.9);
    expect(db.rows('kg_edges')[0]!.sourceDocIds).toHaveLength(1);
    expect(steps.map((step) => step.tool)).toEqual([
      'tool_extract_triplets',
      'tool_extract_triplets',
      'graph_upsert_triplets',
    ]);
  });
});
