import { generateObject, tool, ToolLoopAgent, stepCountIs, type LanguageModel } from 'ai';
import { z } from 'zod';
import { DEFAULT_AGENT_PARAMS, DEFAULT_RUNTIME_PROMPTS, type RuntimeConfig } from '@wf/shared';

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

export const DISCOVERY_DECOMPOSE_PROMPT = DEFAULT_RUNTIME_PROMPTS.discoveryDecompose;
export const DISCOVERY_SYSTEM_PROMPT = DEFAULT_RUNTIME_PROMPTS.discoverySystem;

export async function decomposeQuestion(
  model: LanguageModel,
  question: string,
  options: { prompt?: string } = {},
): Promise<string[]> {
  const { object } = await generateObject({
    model,
    schema: DiscoveryDecompositionSchema,
    system: options.prompt ?? DISCOVERY_DECOMPOSE_PROMPT,
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
  prompts?: Partial<RuntimeConfig['prompts']>;
  agentParams?: Partial<RuntimeConfig['agentParams']>;
  recordStep?: (step: { tool: string; args: unknown; result?: unknown; tookMs?: number }) => void | Promise<void>;
}

export function createDiscoveryAgent(ctx: DiscoveryAgentContext) {
  return new ToolLoopAgent({
    model: ctx.model,
    instructions: ctx.prompts?.discoverySystem ?? DISCOVERY_SYSTEM_PROMPT,
    tools: ctx.tools as never,
    stopWhen: stepCountIs(ctx.stepLimit ?? ctx.agentParams?.discoveryStepLimit ?? DEFAULT_AGENT_PARAMS.discoveryStepLimit) as never,
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
