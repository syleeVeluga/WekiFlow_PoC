import { generateObject, tool, ToolLoopAgent, stepCountIs, type LanguageModel } from 'ai';
import { z } from 'zod';

interface DiscoveryContext {
  source: 'vector' | 'graph';
  content: string;
  score: number;
  documentId?: string;
  path?: { nodes: string[] };
  ranks: { vector?: number; graph?: number };
}

export const DiscoveryDecompositionSchema = z.object({
  baseline: z.string().min(1),
  variants: z.array(z.string().min(1)).max(3).default([]),
});

export type DiscoveryDecomposition = z.infer<typeof DiscoveryDecompositionSchema>;

export const DISCOVERY_DECOMPOSE_PROMPT = `Break the user's question into retrieval queries.
Return the original question as baseline and at most three non-duplicate variants.
Variants should cover synonyms, narrower entities, or Korean/English terminology when useful.
Do not invent facts or filters.`;

export const DISCOVERY_SYSTEM_PROMPT = `You are WekiFlow's Discovery Q&A agent.
Answer only from retrieved WekiFlow context.
First use tool_hybrid_retrieve for the user's question. Use graph or sandbox tools only when exact relations or wording need verification.
Return concise answers with supporting document ids or paths when available.
If context is insufficient, say what is missing instead of guessing.`;

export async function decomposeQuestion(model: LanguageModel, question: string): Promise<string[]> {
  const { object } = await generateObject({
    model,
    schema: DiscoveryDecompositionSchema,
    system: DISCOVERY_DECOMPOSE_PROMPT,
    prompt: question,
  });
  const seen = new Set<string>();
  return [object.baseline, ...object.variants].filter((query) => {
    const key = query.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function contextKey(context: DiscoveryContext): string {
  if (context.documentId) return `doc:${context.documentId}`;
  if (context.path) return `graph:${context.path.nodes.join('>')}`;
  return `${context.source}:${context.content.slice(0, 120)}`;
}

export function rerankDiscoveryContexts<T extends DiscoveryContext>(groups: Array<{ query: string; contexts: T[] }>, k: number): T[] {
  const byKey = new Map<string, { context: T; score: number; queryCount: number; degree: number }>();
  groups.forEach((group) => {
    group.contexts.forEach((context, index) => {
      const key = contextKey(context);
      const degree = context.path?.nodes.length ?? 1;
      const score = context.score + 1 / (60 + index + 1) + degree * 0.001;
      const current = byKey.get(key);
      if (!current) {
        byKey.set(key, { context, score, queryCount: 1, degree });
      } else {
        current.score += score;
        current.queryCount += 1;
        current.degree = Math.max(current.degree, degree);
      }
    });
  });
  return [...byKey.values()]
    .sort((a, b) => b.score - a.score || b.queryCount - a.queryCount || b.degree - a.degree)
    .slice(0, k)
    .map((ranked) => ({ ...ranked.context, score: ranked.score }));
}

export interface DiscoveryAgentContext {
  jobId: string;
  model: LanguageModel;
  tools: Record<string, unknown>;
  stepLimit?: number;
  recordStep?: (step: { tool: string; args: unknown; result?: unknown; tookMs?: number }) => void | Promise<void>;
}

export function createDiscoveryAgent(ctx: DiscoveryAgentContext) {
  return new ToolLoopAgent({
    model: ctx.model,
    instructions: DISCOVERY_SYSTEM_PROMPT,
    tools: ctx.tools as never,
    stopWhen: stepCountIs(ctx.stepLimit ?? 8) as never,
  });
}

export async function askDiscovery(question: string, ctx: DiscoveryAgentContext): Promise<string> {
  const agent = createDiscoveryAgent(ctx);
  const result = await agent.generate({ prompt: question });
  return result.text;
}

export function discoveryAgentAsTool(ctx: DiscoveryAgentContext) {
  return tool({
    description: 'Ask the Discovery Q&A agent to retrieve and answer from WekiFlow knowledge.',
    inputSchema: z.object({ question: z.string().min(1) }),
    execute: async ({ question }) => {
      const answer = await askDiscovery(question, ctx);
      await ctx.recordStep?.({ tool: 'tool_discovery_agent', args: { question }, result: { answer } });
      return { answer };
    },
  });
}
