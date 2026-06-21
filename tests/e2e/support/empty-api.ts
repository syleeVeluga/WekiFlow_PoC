import type { AskResponse } from '@wf/shared';
import { buildServer } from '../../../apps/api/src/server.js';
import { InMemoryWekiFlowStore } from '../../../apps/api/src/store.js';

const port = Number(process.env.PLAYWRIGHT_API_PORT ?? 4100);
const host = process.env.PLAYWRIGHT_HOST ?? '127.0.0.1';

const store = new InMemoryWekiFlowStore();

function clearWorkspaceData() {
  store.documents.clear();
  store.knowledge.clear();
  store.richReviews.clear();
  store.multiSource.clear();
  store.aiTagSuggestions.clear();
  store.candidates.clear();
  store.agentRuns.clear();
  store.trash.clear();
  store.ingestMeta.clear();
  store.activity.length = 0;
}

store.seed();
clearWorkspaceData();
store.seed = () => undefined;

const app = buildServer({
  store,
  discoveryAsk: async ({ question }): Promise<AskResponse> => ({
    answer: `Uploaded knowledge answers this question: ${question}`,
    citations: [],
    usedTrustLevels: [],
    needsAttention: false,
  }),
});

app.post('/api/__test/reset', async () => {
  clearWorkspaceData();
  await store.updateSettings({ reviewApprovalEnabled: false }, 'OWNER');
  return { ok: true };
});

await app.listen({ port, host });
console.log(`Empty WekiFlow test API listening on http://${host}:${port}`);

async function shutdown() {
  await app.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
