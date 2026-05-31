import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { formatKnownTagVocabulary, runGraphPipeline } from './pipeline.js';

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

function isOperatorObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof ObjectId) &&
    Object.keys(value).length > 0 &&
    Object.keys(value).every((key) => key.startsWith('$'))
  );
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, part) => (cur == null ? undefined : (cur as Record<string, unknown>)[part]), obj);
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i]!;
    if (cur[part] == null || typeof cur[part] !== 'object') cur[part] = {};
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

function matches(row: Row, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([key, value]) => {
    if (isOperatorObject(value)) {
      if ('$ne' in value) return !valueEquals(row[key], value.$ne);
      if ('$exists' in value) return (row[key] !== undefined) === Boolean(value.$exists);
      return false;
    }
    return valueEquals(row[key], value);
  });
}

function applyUpdate(row: Row, update: Record<string, unknown>, inserting: boolean) {
  if (inserting && update.$setOnInsert) Object.assign(row, update.$setOnInsert);
  if (update.$set) {
    for (const [key, value] of Object.entries(update.$set as Record<string, unknown>)) setPath(row, key, value);
  }
  if (update.$max) {
    for (const [key, value] of Object.entries(update.$max as Record<string, number>)) {
      row[key] = Math.max(Number(row[key] ?? Number.NEGATIVE_INFINITY), value);
    }
  }
  if (update.$addToSet) {
    for (const [key, raw] of Object.entries(update.$addToSet as Record<string, unknown>)) {
      const toAdd =
        raw && typeof raw === 'object' && '$each' in (raw as Record<string, unknown>)
          ? ((raw as { $each: unknown[] }).$each ?? [])
          : [raw];
      const existing = getPath(row, key);
      const values = Array.isArray(existing) ? existing : [];
      for (const value of toAdd) if (!values.some((current) => valueEquals(current, value))) values.push(value);
      setPath(row, key, values);
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
        find(query: Record<string, unknown> = {}) {
          return {
            async toArray() {
              return rows.filter((row) => matches(row, query));
            },
          };
        },
        async distinct(field: string, query: Record<string, unknown> = {}) {
          const seen = new Set<string>();
          const out: unknown[] = [];
          for (const row of rows.filter((row) => matches(row, query))) {
            const value = getPath(row, field);
            const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
            for (const entry of list) {
              const key = entry instanceof ObjectId ? entry.toHexString() : JSON.stringify(entry);
              if (!seen.has(key)) {
                seen.add(key);
                out.push(entry);
              }
            }
          }
          return out;
        },
        async deleteMany(query: Record<string, unknown>) {
          const keep = rows.filter((row) => !matches(row, query));
          rows.length = 0;
          rows.push(...keep);
        },
        async insertMany(docs: Row[]) {
          rows.push(...docs);
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
  it('caps the known-tag vocabulary used in classifier prompts', () => {
    const tags = Array.from({ length: 150 }, (_value, index) => `tag-${String(index + 1).padStart(3, '0')}`);
    const vocabulary = formatKnownTagVocabulary(tags);

    expect(vocabulary.split(', ')).toHaveLength(100);
    expect(vocabulary).toContain('tag-100');
    expect(vocabulary).not.toContain('tag-101');
    expect(vocabulary.length).toBeLessThanOrEqual(2000);
  });

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
      embed: async (texts) => texts.map(() => [1, 0]),
      embeddingModel: 'text-embedding-3-large',
      recordStep: (step) => {
        steps.push(step);
      },
    });

    expect(result).toMatchObject({
      documentId: documentId.toHexString(),
      status: 'GRAPH_INDEXED',
      chunkCount: 2,
      tripletCount: 1,
    });
    expect(result.triplets).toHaveLength(1);
    expect(db.rows('documents')[0]!.status).toBe('GRAPH_INDEXED');
    expect(db.rows('kg_nodes')).toHaveLength(2);
    expect(db.rows('kg_nodes').map((node) => node.normalizedName).sort()).toEqual([
      'annualleave15days',
      'newhire',
    ]);
    expect(db.rows('kg_edges')).toHaveLength(1);
    expect(db.rows('kg_edges')[0]!.strength).toBe(0.9);
    expect(db.rows('kg_edges')[0]!.sourceDocIds).toHaveLength(1);
    expect(db.rows('chunks')).toHaveLength(2);
    expect(steps.map((step) => step.tool)).toEqual([
      'tool_extract_triplets',
      'tool_extract_triplets',
      'graph_upsert_triplets',
      'graph_index_chunks',
    ]);
  });

  it('returns preview triplets without writing graph rows or changing document status when persist is false', async () => {
    const documentId = new ObjectId();
    const db = createMemoryDb({
      documents: [
        {
          _id: documentId,
          slug: 'policy',
          title: 'Policy',
          parentId: null,
          isFolder: false,
          status: 'PREVIEW',
          contentMarkdown: '# A\nNew hires receive 15 annual leave days.',
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
      persist: false,
      extractTriplets: async () => ({
        triplets: [
          {
            subject: 'New Hire',
            predicate: 'receives',
            object: 'Annual Leave 15 Days',
            subjectType: 'PERSON',
            objectType: 'REGULATION',
            strength: 0.9,
          },
        ],
      }),
      recordStep: (step) => {
        steps.push(step);
      },
    });

    expect(result).toMatchObject({
      documentId: documentId.toHexString(),
      status: 'PREVIEW',
      chunkCount: 1,
      tripletCount: 1,
    });
    expect(result.triplets).toHaveLength(1);
    expect(db.rows('documents')[0]!.status).toBe('PREVIEW');
    expect(db.rows('kg_nodes')).toHaveLength(0);
    expect(db.rows('kg_edges')).toHaveLength(0);
    expect(steps.map((step) => step.tool)).toEqual(['tool_extract_triplets', 'graph_preview_triplets']);
  });

  it('classifies and unions AI tags after indexing, reusing existing vocabulary', async () => {
    const documentId = new ObjectId();
    const otherDocId = new ObjectId();
    const db = createMemoryDb({
      documents: [
        {
          _id: documentId,
          slug: 'leave',
          title: 'Leave',
          parentId: null,
          isFolder: false,
          status: 'PUBLISHED',
          contentMarkdown: '# 휴가\n신입은 연차 15일을 받는다.',
          draftMarkdown: null,
          version: 1,
          sourceRefs: [],
          wiki: { id: documentId.toHexString(), aiTags: ['기존'] },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        // A second published doc + a topic provide the existing vocabulary the classifier should reuse.
        { _id: otherDocId, status: 'PUBLISHED', wiki: { id: otherDocId.toHexString(), aiTags: ['복지', '인사'] } },
      ],
      topics: [
        { _id: new ObjectId(), name: '계획' },
        { _id: new ObjectId(), name: '미분류', isUnclassified: true },
      ],
    });
    const steps: Array<{ tool: string; args: unknown; result?: unknown }> = [];
    let receivedKnownTags: string[] = [];
    let receivedContent = '';

    const result = await runGraphPipeline(documentId.toHexString(), {
      db: db as never,
      extractTriplets: async () => ({ triplets: [] }),
      classifyTags: async (content, knownTags) => {
        receivedContent = content;
        receivedKnownTags = knownTags;
        return { tags: ['복지', '신규'], modelLabel: 'test-model' };
      },
      embed: async (texts) => texts.map(() => [1, 0]),
      embeddingModel: 'text-embedding-3-large',
      recordStep: (step) => {
        steps.push(step);
      },
    });

    expect(result.status).toBe('GRAPH_INDEXED');
    // Classifier sees the whole document plus the existing tag/topic vocabulary.
    expect(receivedContent).toContain('연차');
    expect(receivedKnownTags).toEqual(expect.arrayContaining(['기존', '복지', '인사', '계획']));
    expect(receivedKnownTags).not.toContain('미분류');
    // New tags are unioned into the target doc, preserving the pre-existing tag.
    const target = db.rows('documents').find((row) => row._id.equals(documentId))!;
    expect((target.wiki as { aiTags: string[] }).aiTags).toEqual(['기존', '복지', '신규']);
    // The classify step runs after indexing and reports the resulting tags.
    expect(steps.map((step) => step.tool)).toEqual([
      'tool_extract_triplets',
      'graph_upsert_triplets',
      'graph_index_chunks',
      'graph_classify_tags',
    ]);
    expect(steps.find((step) => step.tool === 'graph_classify_tags')?.result).toMatchObject({
      tags: ['복지', '신규'],
      model: 'test-model',
    });
  });

  it('does not fail the job when tag classification throws', async () => {
    const documentId = new ObjectId();
    const db = createMemoryDb({
      documents: [
        {
          _id: documentId,
          slug: 'leave',
          title: 'Leave',
          parentId: null,
          isFolder: false,
          status: 'PUBLISHED',
          contentMarkdown: '# 휴가\n신입은 연차 15일을 받는다.',
          draftMarkdown: null,
          version: 1,
          sourceRefs: [],
          wiki: { id: documentId.toHexString(), aiTags: [] },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
    const steps: Array<{ tool: string; args: unknown; result?: unknown }> = [];

    const result = await runGraphPipeline(documentId.toHexString(), {
      db: db as never,
      extractTriplets: async () => ({ triplets: [] }),
      classifyTags: async () => {
        throw new Error('model unavailable');
      },
      embed: async (texts) => texts.map(() => [1, 0]),
      embeddingModel: 'text-embedding-3-large',
      recordStep: (step) => {
        steps.push(step);
      },
    });

    // Triplets are the primary deliverable: the doc is still indexed and the failure is logged, not thrown.
    expect(result.status).toBe('GRAPH_INDEXED');
    expect((db.rows('documents')[0]!.wiki as { aiTags: string[] }).aiTags).toEqual([]);
    expect(steps.find((step) => step.tool === 'graph_classify_tags')?.result).toMatchObject({ error: 'model unavailable' });
  });
});
