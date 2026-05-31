import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { closeMongoClient, getDb } from '@wf/db';
import {
  createDefaultTopics,
  loadEnv,
  seedDemoUsers,
} from '@wf/shared';

function stableObjectId(input: string): ObjectId {
  return new ObjectId(createHash('md5').update(input).digest('hex').slice(0, 24));
}

const db = await getDb();
const now = new Date();

await db.collection('documents').deleteMany({ 'wiki.id': { $exists: true } });
await Promise.all([
  db.collection('topics').deleteMany({}),
  db.collection('review_items').deleteMany({}),
  db.collection('multi_source_groups').deleteMany({}),
  db.collection('ai_tag_suggestions').deleteMany({}),
  db.collection('activity_log').deleteMany({}),
]);

// 사용자 시드: 소유자(.env) + 데모 5명. 비밀번호는 이메일과 동일.
// $setOnInsert만 사용해 재시드 시 UI에서 변경한 역할을 덮어쓰지 않는다.
const env = loadEnv();
const seedUsers = [
  { name: '소유자', email: env.ADMIN_EMAIL, role: 'OWNER', password: env.ADMIN_PASSWORD },
  ...seedDemoUsers.map((user) => ({ ...user, password: user.email })),
];
for (const user of seedUsers) {
  await db.collection('users').updateOne(
    { email: user.email },
    { $setOnInsert: { _id: stableObjectId(`user:${user.email}`), ...user, createdAt: now } },
    { upsert: true },
  );
}

for (const topic of createDefaultTopics()) {
  await db.collection('topics').updateOne(
    { name: topic.name },
    { $setOnInsert: { ...topic, createdAt: now } },
    { upsert: true },
  );
}

const counts = {
  users: await db.collection('users').countDocuments(),
  documents: await db.collection('documents').countDocuments({ 'wiki.id': { $exists: false } }),
  wiki_documents: await db.collection('documents').countDocuments({ 'wiki.id': { $exists: true } }),
  topics: await db.collection('topics').countDocuments(),
  review_items: await db.collection('review_items').countDocuments(),
  multi_source_groups: await db.collection('multi_source_groups').countDocuments(),
  ai_tag_suggestions: await db.collection('ai_tag_suggestions').countDocuments(),
  activity_log: await db.collection('activity_log').countDocuments(),
};

await closeMongoClient();
console.log(JSON.stringify(counts, null, 2));
