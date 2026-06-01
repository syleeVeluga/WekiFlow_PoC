import type { Db } from 'mongodb';
import { pathToFileURL } from 'node:url';
import { closeMongoClient, getDb } from './client.js';

export async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection('documents').createIndex({ parentId: 1 }),
    db.collection('documents').createIndex({ status: 1 }),
    db.collection('documents').createIndex({ slug: 1 }, { unique: true }),
    db.collection('documents').createIndex({ topicId: 1 }),
    db.collection('documents').createIndex({ department: 1 }),
    db.collection('documents').createIndex({ freshness: 1 }),
    db.collection('documents').createIndex(
      { 'ingestion.idempotencyScope': 1 },
      {
        unique: true,
        partialFilterExpression: { 'ingestion.idempotencyScope': { $type: 'string' } },
      },
    ),
    db.collection('documents').createIndex({ 'ingestion.workspaceId': 1, 'ingestion.sourceName': 1 }),
    db.collection('chunks').createIndex({ documentId: 1, chunkIndex: 1 }, { unique: true }),
    db.collection('kg_nodes').createIndex({ normalizedName: 1 }, { unique: true }),
    db.collection('kg_nodes').createIndex({ type: 1 }),
    db.collection('kg_edges').createIndex(
      { subjectId: 1, predicate: 1, objectId: 1 },
      { unique: true },
    ),
    db.collection('kg_edges').createIndex({ subjectId: 1 }),
    db.collection('kg_edges').createIndex({ objectId: 1 }),
    db.collection('jobs').createIndex({ queue: 1, status: 1 }),
    db.collection('jobs').createIndex({ type: 1 }),
    db.collection('jobs').createIndex({ documentId: 1 }),
    db.collection('users').createIndex({ email: 1 }, { unique: true }),
    db.collection('sessions').createIndex({ token: 1 }, { unique: true }),
    db.collection('sandbox_runs').createIndex({ jobId: 1 }),
    db.collection('sandbox_runs').createIndex({ createdAt: 1 }),
    db.collection('topics').createIndex({ name: 1 }, { unique: true }),
    db.collection('review_items').createIndex({ resolved: 1, createdAt: -1 }),
    db.collection('multi_source_groups').createIndex({ resolved: 1 }),
    db.collection('ai_tag_suggestions').createIndex({ status: 1 }),
    db.collection('activity_log').createIndex({ createdAt: -1 }),
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = await getDb();
  await ensureIndexes(db);
  await closeMongoClient();
  console.log('MongoDB indexes ensured');
}
