import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { closeMongoClient, getDb } from '@wf/db';
import {
  createSeedActivity,
  createSeedAiTagSuggestions,
  createSeedKnowledgeItems,
  createSeedMultiSourceGroups,
  createSeedReviews,
  createSeedTopics,
} from '@wf/shared';

function stableObjectId(input: string): ObjectId {
  return new ObjectId(createHash('md5').update(input).digest('hex').slice(0, 24));
}

const db = await getDb();
const now = new Date();

const topics = createSeedTopics();
for (const topic of topics) {
  await db.collection('topics').updateOne(
    { name: topic.name },
    {
      $set: { ...topic, updatedAt: now },
      $setOnInsert: { _id: stableObjectId(`topic:${topic.id}`), createdAt: now },
    },
    { upsert: true },
  );
}

const topicRows = await db.collection('topics').find({}).toArray();
const topicIdByName = new Map(topicRows.map((topic) => [String(topic.name), topic._id]));

for (const item of createSeedKnowledgeItems()) {
  const docObjectId = stableObjectId(`document:${item.id}`);
  await db.collection('documents').updateOne(
    { slug: item.id },
    {
      $set: {
        title: item.title,
        parentId: null,
        isFolder: false,
        status: 'PUBLISHED',
        contentMarkdown: item.contentMarkdown,
        draftMarkdown: null,
        version: Math.max(1, item.modCount + 1),
        sourceRefs: [{ type: 'datasource', ref: `seed://${item.id}`, note: item.sourceLabel }],
        topicId: topicIdByName.get(item.category) ?? null,
        department: item.department,
        freshness: item.freshness,
        wiki: item,
        updatedAt: now,
      },
      $setOnInsert: { _id: docObjectId, slug: item.id, createdAt: now },
    },
    { upsert: true },
  );
}

for (const review of createSeedReviews()) {
  await db.collection('review_items').updateOne(
    { id: review.id },
    { $set: { ...review, updatedAt: now }, $setOnInsert: { _id: stableObjectId(`review:${review.id}`), createdAt: now } },
    { upsert: true },
  );
}

for (const group of createSeedMultiSourceGroups()) {
  await db.collection('multi_source_groups').updateOne(
    { id: group.id },
    { $set: { ...group, updatedAt: now }, $setOnInsert: { _id: stableObjectId(`ms:${group.id}`), createdAt: now } },
    { upsert: true },
  );
}

for (const suggestion of createSeedAiTagSuggestions()) {
  await db.collection('ai_tag_suggestions').updateOne(
    { id: suggestion.id },
    { $set: { ...suggestion, updatedAt: now }, $setOnInsert: { _id: stableObjectId(`tag:${suggestion.id}`), createdAt: now } },
    { upsert: true },
  );
}

for (const activity of createSeedActivity()) {
  await db.collection('activity_log').updateOne(
    { id: activity.id },
    { $set: { ...activity, updatedAt: now }, $setOnInsert: { _id: stableObjectId(`activity:${activity.id}`), createdAt: now } },
    { upsert: true },
  );
}

const counts = {
  documents: await db.collection('documents').countDocuments({ slug: /^k\d+/ }),
  topics: await db.collection('topics').countDocuments(),
  review_items: await db.collection('review_items').countDocuments(),
  multi_source_groups: await db.collection('multi_source_groups').countDocuments(),
  ai_tag_suggestions: await db.collection('ai_tag_suggestions').countDocuments(),
  activity_log: await db.collection('activity_log').countDocuments(),
};

await closeMongoClient();
console.log(JSON.stringify(counts, null, 2));
