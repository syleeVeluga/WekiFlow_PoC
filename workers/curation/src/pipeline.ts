import type { Queue } from 'bullmq';
import { ToolLoopAgent, stepCountIs, type LanguageModel } from 'ai';
import type { Db } from 'mongodb';
import type { SandboxRunner } from '@wf/sandbox';
import { DEFAULT_AGENT_PARAMS, type RuntimeConfig } from '@wf/shared';
import {
  buildCurationPrompt,
  createCurationTools,
  CURATION_SYSTEM_PROMPT,
  type AgentStep,
} from '@wf/agent-tools';
import { loadPolicy, scanStale, type Policy, type StaleConcept } from '@wekiflow/wkf';

export const CURATION_SCAN_JOB_ID = 'curation-scan';
export const DEFAULT_CURATION_CRON = '0 3 * * *';
export const DEFAULT_SCAN_LIMIT = 100;

export interface CurationConceptJob {
  type: 'CURATE_CONCEPT';
  concept: StaleConcept;
}

export interface CurationScanResult {
  queued: number;
  stale: StaleConcept[];
}

export type CurationDecision = 'verify' | 'enhance' | 'create' | 'skip';

export interface CurationAgentResult {
  slug: string;
  decision: CurationDecision;
  status: 'verified' | 'review' | 'skipped';
  documentId?: string;
  lastVerified?: string;
}

export interface CurationAgentContext {
  db: Db;
  sandbox: SandboxRunner;
  bundlePath: string;
  docsSnapshotDir: string;
  jobId: string;
  model: LanguageModel;
  policy?: Policy;
  now?: Date;
  stepLimit?: number;
  prompts?: Partial<RuntimeConfig['prompts']>;
  agentParams?: Partial<RuntimeConfig['agentParams']>;
  onStep?: (step: unknown) => void | Promise<void>;
  recordStep?: (step: AgentStep) => void | Promise<void>;
}

export async function registerCurationSchedule(
  queue: Pick<Queue, 'add'>,
  cron = DEFAULT_CURATION_CRON,
): Promise<void> {
  await queue.add('SCAN_STALE', { type: 'SCAN_STALE' }, { jobId: CURATION_SCAN_JOB_ID, repeat: { pattern: cron } });
}

export async function runCurationScan(
  queue: Pick<Queue, 'add'>,
  bundlePath: string,
  options: { policy?: Policy; limit?: number; now?: Date } = {},
): Promise<CurationScanResult> {
  const policy = options.policy ?? (await loadPolicy(bundlePath));
  const stale = await scanStale(bundlePath, policy, {
    limit: options.limit ?? DEFAULT_SCAN_LIMIT,
    ...(options.now ? { now: options.now } : {}),
  });
  for (const concept of stale) {
    await queue.add('CURATE_CONCEPT', { type: 'CURATE_CONCEPT', concept } satisfies CurationConceptJob, {
      jobId: `curate:${concept.slug}`,
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }
  return { queued: stale.length, stale };
}

export function extractCurationResult(
  slug: string,
  steps: ReadonlyArray<{ toolResults?: ReadonlyArray<{ toolName: string; output: unknown }> }>,
): CurationAgentResult | undefined {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const toolResults = steps[i]?.toolResults ?? [];
    for (const toolResult of toolResults) {
      if (toolResult.toolName !== 'tool_write_concept' || !toolResult.output || typeof toolResult.output !== 'object') continue;
      const output = toolResult.output as Record<string, unknown>;
      const decision = output.decision;
      const status = output.status;
      if (
        (decision === 'verify' || decision === 'enhance' || decision === 'create' || decision === 'skip') &&
        (status === 'verified' || status === 'review' || status === 'skipped')
      ) {
        return {
          slug,
          decision,
          status,
          ...(typeof output.documentId === 'string' ? { documentId: output.documentId } : {}),
          ...(typeof output.lastVerified === 'string' ? { lastVerified: output.lastVerified } : {}),
        };
      }
    }
  }
  return undefined;
}

export async function runCurationAgent(job: CurationConceptJob, ctx: CurationAgentContext): Promise<CurationAgentResult> {
  const policy = ctx.policy ?? (await loadPolicy(ctx.bundlePath));
  const recordedSteps: AgentStep[] = [];
  const tools = createCurationTools({
    db: ctx.db,
    sandbox: ctx.sandbox,
    bundlePath: ctx.bundlePath,
    docsSnapshotDir: ctx.docsSnapshotDir,
    concept: job.concept,
    policy,
    ...(ctx.now ? { now: ctx.now } : {}),
    ...(ctx.agentParams ? { agentParams: ctx.agentParams } : {}),
    recordStep: async (step) => {
      recordedSteps.push(step);
      await ctx.recordStep?.(step);
    },
  });
  const agent = new ToolLoopAgent({
    model: ctx.model,
    instructions: ctx.prompts?.curation ?? CURATION_SYSTEM_PROMPT,
    tools,
    stopWhen: stepCountIs(
      ctx.stepLimit ?? ctx.agentParams?.curationStepLimit ?? policy.enrichment.agent_step_limit ?? DEFAULT_AGENT_PARAMS.curationStepLimit,
    ),
  });

  const result = await agent.generate({
    prompt: buildCurationPrompt(job.concept),
    ...(ctx.onStep ? { onStepFinish: ctx.onStep } : {}),
  });
  const decision = extractCurationResult(job.concept.slug, result.steps);
  if (!decision) {
    const rejected = recordedSteps.findLast(
      (step) =>
        step.tool === 'tool_write_concept' &&
        step.result &&
        typeof step.result === 'object' &&
        (step.result as { status?: unknown }).status === 'rejected',
    );
    if (rejected) {
      const reason =
        rejected.result && typeof rejected.result === 'object' && 'reason' in rejected.result
          ? String((rejected.result as { reason: unknown }).reason)
          : 'curation write rejected';
      throw new Error(reason);
    }
    return { slug: job.concept.slug, decision: 'skip', status: 'skipped' };
  }
  return decision;
}
