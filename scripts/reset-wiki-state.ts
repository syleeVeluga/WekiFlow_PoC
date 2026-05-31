import { closeMongoClient, getDb } from '@wf/db';
import { createDefaultTopics } from '@wf/shared';

const db = await getDb();
const now = new Date();

const [
  wikiDocuments,
  reviewItems,
  multiSourceGroups,
  aiTagSuggestions,
  activityLog,
  oldTopics,
] = await Promise.all([
  db.collection('documents').deleteMany({ 'wiki.id': { $exists: true } }),
  db.collection('review_items').deleteMany({}),
  db.collection('multi_source_groups').deleteMany({}),
  db.collection('ai_tag_suggestions').deleteMany({}),
  db.collection('activity_log').deleteMany({}),
  db.collection('topics').deleteMany({ isUnclassified: { $ne: true } }),
]);

for (const topic of createDefaultTopics()) {
  await db.collection('topics').updateOne(
    { name: topic.name },
    { $set: { ...topic, updatedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true },
  );
}

const counts = {
  deleted: {
    wiki_documents: wikiDocuments.deletedCount,
    review_items: reviewItems.deletedCount,
    multi_source_groups: multiSourceGroups.deletedCount,
    ai_tag_suggestions: aiTagSuggestions.deletedCount,
    activity_log: activityLog.deletedCount,
    topics: oldTopics.deletedCount,
  },
  remaining: {
    wiki_documents: await db.collection('documents').countDocuments({ 'wiki.id': { $exists: true } }),
    topics: await db.collection('topics').countDocuments(),
  },
  topics: await db.collection('topics').find({}, { projection: { _id: 0, id: 1, name: 1, source: 1, isUnclassified: 1 } }).toArray(),
};

await closeMongoClient();
console.log(JSON.stringify(counts, null, 2));
