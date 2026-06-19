import { cosineSimilarity, embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { config as loadDotenv } from 'dotenv';
import { createChunksRepo, createRetrievalGoldensRepo, getDb, closeMongoClient } from '@wf/db';
import { loadEnv } from '@wf/shared';

loadDotenv({ quiet: true });

function containsAnswer(text: string, answer: string): boolean {
  return text.toLowerCase().includes(answer.trim().toLowerCase());
}

const env = loadEnv();
const db = await getDb();
try {
  const goldens = await createRetrievalGoldensRepo(db).list();
  const chunks = createChunksRepo(db);
  const embeddingModel = openai.textEmbeddingModel(env.EMBEDDING_MODEL);
  let passed = 0;
  const rows = [];
  for (const golden of goldens) {
    const [queryEmbedding] = (await embedMany({ model: embeddingModel, values: [golden.intent] })).embeddings;
    const hits = (await chunks.listForSearch())
      .filter((row) => queryEmbedding && row.embedding.length === queryEmbedding.length)
      .map((row) => ({ ...row, score: cosineSimilarity(queryEmbedding!, row.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    const hit = hits.find((candidate) => containsAnswer(candidate.text, golden.goldenAnswer));
    if (hit) passed += 1;
    rows.push({
      intent: golden.intent,
      expected: golden.goldenAnswer,
      passed: Boolean(hit),
      topDocumentId: hits[0]?.documentId ?? null,
      topScore: hits[0]?.score ?? null,
    });
  }
  const total = goldens.length;
  console.log(JSON.stringify({ total, passed, recallAt5: total === 0 ? 1 : passed / total, rows }, null, 2));
  if (total > 0 && passed < total) process.exitCode = 1;
} finally {
  await closeMongoClient();
}
