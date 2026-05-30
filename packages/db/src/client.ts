import { MongoClient, type Db } from 'mongodb';
import { loadEnv } from '@wf/shared';

let client: MongoClient | undefined;

export async function getMongoClient(): Promise<MongoClient> {
  if (!client) {
    const env = loadEnv();
    client = new MongoClient(env.MONGODB_URI);
    await client.connect();
  }

  return client;
}

export async function getDb(): Promise<Db> {
  const env = loadEnv();
  const mongo = await getMongoClient();
  return mongo.db(env.MONGODB_DB);
}

export async function closeMongoClient(): Promise<void> {
  if (client) {
    await client.close();
    client = undefined;
  }
}
