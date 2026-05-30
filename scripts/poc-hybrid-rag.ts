/**
 * Phase 4 PoC: graph-indexed knowledge is retrieved back into Pipeline A and fused with vector hits.
 *
 * Run: pnpm tsx scripts/poc-hybrid-rag.ts
 */
import { ObjectId, type Db } from 'mongodb';
import { createMainTools, type AgentStep } from '@wf/agent-tools';
import type { SandboxRunner } from '@wf/sandbox';

function makeFakeDb(seed: Record<string, Record<string, unknown>[]>): Db {
  const store = seed;
  const matches = (doc: Record<string, unknown>, filter: Record<string, unknown>) =>
    Object.entries(filter).every(([key, value]) => String(doc[key]) === String(value));

  const collection = (name: string) => {
    const rows = (store[name] ??= []);
    return {
      find: (filter: Record<string, unknown> = {}) => ({
        toArray: async () => rows.filter((row) => matches(row, filter)),
      }),
      findOne: async (filter: Record<string, unknown>) => rows.find((row) => matches(row, filter)) ?? null,
    };
  };

  return { collection } as unknown as Db;
}

const sandbox: SandboxRunner = {
  async run() {
    return { stdout: '', stderr: '', exitCode: 0, truncated: false };
  },
};

const newHire = new ObjectId();
const leave = new ObjectId();
const db = makeFakeDb({
  chunks: [
    {
      documentId: new ObjectId(),
      text: 'Onboarding documents mention leave entitlement for new hires.',
      headingPath: ['Onboarding'],
      embedding: [1, 0],
    },
  ],
  kg_nodes: [
    { _id: newHire, name: 'New Hire', normalizedName: 'newhire', type: 'PERSON' },
    { _id: leave, name: 'Annual Leave 15 Days', normalizedName: 'annualleave15days', type: 'REGULATION' },
  ],
  kg_edges: [{ subjectId: newHire, predicate: 'receives', objectId: leave, strength: 0.9 }],
});

const steps: AgentStep[] = [];
const tools = createMainTools({
  db,
  sandbox,
  docsSnapshotDir: '/tmp/docs',
  jobId: 'poc-hybrid',
  documentId: new ObjectId().toHexString(),
  embed: async (texts) => texts.map(() => [1, 0]),
  model: {} as never,
  recordStep: (step) => void steps.push(step),
});

const result = (await tools.tool_hybrid_retrieve.execute!(
  { query: 'annual leave for new hires', startEntity: 'New Hire', k: 4, maxDepth: 2 },
  { toolCallId: 'poc-hybrid', messages: [] },
)) as { contexts: Array<{ source: string; content: string }> };

const hasVector = result.contexts.some((context) => context.source === 'vector');
const hasGraph = result.contexts.some(
  (context) => context.source === 'graph' && context.content.includes('New Hire -[receives'),
);

if (!hasVector || !hasGraph) {
  console.error(JSON.stringify({ result, steps }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(result, null, 2));
console.log('Hybrid RAG PoC passed: vector context and graph path were fused for Pipeline A.');
