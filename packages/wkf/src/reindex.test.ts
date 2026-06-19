import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ObjectId, type Db } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { reindexBundle } from './reindex.js';

async function tempBundle(): Promise<string> {
  const root = join(tmpdir(), `wkf-reindex-${randomUUID()}`);
  await mkdir(join(root, 'hr'), { recursive: true });
  await writeFile(
    join(root, 'hr', 'annual-leave.md'),
    `---
type: REGULATION
title: Annual Leave
slug: hr/annual-leave
status: PUBLISHED
---
# Policy
New employees receive annual leave.

# Relations
- (New Employee) -[receives]-> (Annual Leave) {strength: 0.9}
- (Annual Leave) -[approved_by]-> (Department Head) {strength: 0.8, ref: /hr/approval.md}
`,
    'utf8',
  );
  return root;
}

function normalize(value: unknown): unknown {
  if (value instanceof ObjectId) return value.toHexString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== '_id')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  }
  return value;
}

class MemoryCollection {
  rows: Record<string, unknown>[] = [];

  async deleteMany(filter: Record<string, unknown>): Promise<void> {
    if (Object.keys(filter).length === 0) {
      this.rows = [];
      return;
    }
    this.rows = this.rows.filter((row) => !matches(row, filter));
  }

  async distinct(key: string): Promise<unknown[]> {
    const values = new Map<string, unknown>();
    for (const row of this.rows) {
      const value = row[key];
      values.set(JSON.stringify(normalize(value)), value);
    }
    return [...values.values()];
  }

  async insertMany(rows: Record<string, unknown>[]): Promise<void> {
    this.rows.push(...rows.map((row) => ({ _id: new ObjectId(), ...row })));
  }

  async findOneAndUpdate(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<Record<string, unknown>> {
    let row = this.rows.find((candidate) => matches(candidate, filter));
    if (!row) {
      row = { _id: new ObjectId(), ...filter };
      this.rows.push(row);
      applySet(row, update.$setOnInsert as Record<string, unknown> | undefined);
    }
    applySet(row, update.$set as Record<string, unknown> | undefined);
    applyAddToSet(row, update.$addToSet as Record<string, unknown> | undefined);
    return row;
  }

  async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<void> {
    let row = this.rows.find((candidate) => matches(candidate, filter));
    if (!row) {
      row = { _id: new ObjectId(), ...filter };
      this.rows.push(row);
      applySet(row, update.$setOnInsert as Record<string, unknown> | undefined);
    }
    applySet(row, update.$set as Record<string, unknown> | undefined);
    applyMax(row, update.$max as Record<string, number> | undefined);
    applyAddToSet(row, update.$addToSet as Record<string, unknown> | undefined);
  }

  async updateMany(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<void> {
    for (const row of this.rows.filter((candidate) => matches(candidate, filter))) {
      const pull = update.$pull as Record<string, unknown> | undefined;
      if (!pull) continue;
      for (const [key, value] of Object.entries(pull)) {
        const current = row[key];
        if (Array.isArray(current)) row[key] = current.filter((entry) => !equalValue(entry, value));
      }
    }
  }

  snapshot(): unknown[] {
    return this.rows
      .map(normalize)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
}

class MemoryDb {
  collections = new Map<string, MemoryCollection>();

  collection(name: string): MemoryCollection {
    let collection = this.collections.get(name);
    if (!collection) {
      collection = new MemoryCollection();
      this.collections.set(name, collection);
    }
    return collection;
  }

  snapshot(): Record<string, unknown[]> {
    return Object.fromEntries(
      [...this.collections.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, collection]) => [name, collection.snapshot()]),
    );
  }
}

function equalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function matches(row: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  if ('$or' in filter) return (filter.$or as Record<string, unknown>[]).some((entry) => matches(row, entry));
  return Object.entries(filter).every(([key, value]) => {
    if (value && typeof value === 'object' && '$size' in value) return Array.isArray(row[key]) && row[key].length === value.$size;
    if (value && typeof value === 'object' && '$exists' in value) return (key in row) === value.$exists;
    if (value && typeof value === 'object' && '$nin' in value) return !(value.$nin as unknown[]).some((entry) => equalValue(row[key], entry));
    if (Array.isArray(row[key])) return (row[key] as unknown[]).some((entry) => equalValue(entry, value));
    return equalValue(row[key], value);
  });
}

function applySet(row: Record<string, unknown>, set: Record<string, unknown> | undefined): void {
  if (!set) return;
  Object.assign(row, set);
}

function applyMax(row: Record<string, unknown>, max: Record<string, number> | undefined): void {
  if (!max) return;
  for (const [key, value] of Object.entries(max)) {
    row[key] = typeof row[key] === 'number' ? Math.max(row[key], value) : value;
  }
}

function applyAddToSet(row: Record<string, unknown>, addToSet: Record<string, unknown> | undefined): void {
  if (!addToSet) return;
  for (const [key, value] of Object.entries(addToSet)) {
    const current = Array.isArray(row[key]) ? (row[key] as unknown[]) : [];
    if (!current.some((entry) => equalValue(entry, value))) current.push(value);
    row[key] = current;
  }
}

describe('reindexBundle', () => {
  it('rebuilds chunks and graph rows deterministically from a bundle', async () => {
    const bundle = await tempBundle();
    const db = new MemoryDb();

    const first = await reindexBundle(db as unknown as Db, bundle, { all: true });
    const firstSnapshot = db.snapshot();
    const second = await reindexBundle(db as unknown as Db, bundle, { all: true });
    const secondSnapshot = db.snapshot();

    expect(first).toMatchObject({ chunkCount: 2, relationCount: 2 });
    expect(second).toEqual(first);
    expect(secondSnapshot).toEqual(firstSnapshot);
    expect(db.collection('kg_edges').rows).toHaveLength(2);
    expect(db.collection('kg_nodes').rows.map((row) => row.normalizedName).sort()).toEqual([
      'annualleave',
      'departmenthead',
      'newemployee',
    ]);
  });

  it('supports drop-and-restore recovery with the same snapshot', async () => {
    const bundle = await tempBundle();
    const db = new MemoryDb();
    await reindexBundle(db as unknown as Db, bundle, { all: true });
    const snapshot = db.snapshot();

    await Promise.all([
      db.collection('chunks').deleteMany({}),
      db.collection('kg_edges').deleteMany({}),
      db.collection('kg_nodes').deleteMany({}),
    ]);

    await reindexBundle(db as unknown as Db, bundle, { all: true });
    expect(db.snapshot()).toEqual(snapshot);
  });

  it('removes orphan KG nodes during concept reindex', async () => {
    const bundle = await tempBundle();
    const db = new MemoryDb();
    await reindexBundle(db as unknown as Db, bundle, { all: true });

    const path = join(bundle, 'hr', 'annual-leave.md');
    const original = await readFile(path, 'utf8');
    await writeFile(path, original.replace('- (Annual Leave) -[approved_by]-> (Department Head) {strength: 0.8, ref: /hr/approval.md}\n', ''), 'utf8');

    await reindexBundle(db as unknown as Db, bundle, { concept: 'hr/annual-leave' });

    expect(db.collection('kg_edges').rows).toHaveLength(1);
    expect(db.collection('kg_nodes').rows.map((row) => row.normalizedName).sort()).toEqual(['annualleave', 'newemployee']);
  });
});
