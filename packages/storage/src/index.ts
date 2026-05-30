import { Client } from 'minio';
import { loadEnv } from '@wf/shared';

export function createMinioClient() {
  const env = loadEnv();
  return new Client({
    endPoint: env.MINIO_ENDPOINT,
    port: env.MINIO_PORT,
    useSSL: env.MINIO_USE_SSL,
    accessKey: env.MINIO_ACCESS_KEY,
    secretKey: env.MINIO_SECRET_KEY,
  });
}

export async function ensureBuckets(client = createMinioClient(), buckets = ['documents', 'assets']) {
  for (const bucket of buckets) {
    const exists = await client.bucketExists(bucket);
    if (!exists) {
      await client.makeBucket(bucket);
    }
  }
}

export async function putObject(bucket: string, key: string, content: string | Buffer) {
  const client = createMinioClient();
  await client.putObject(bucket, key, content);
}
