import { ToolLoopAgent, stepCountIs, type LanguageModel } from 'ai';
import type { Db } from 'mongodb';
import { createDocumentsRepo } from '@wf/db';
import { DEFAULT_AGENT_PARAMS, MergeResultSchema, type MergeResult, type RuntimeConfig } from '@wf/shared';
import type { SandboxRunner } from '@wf/sandbox';
import {
  MAIN_AGENT_SYSTEM_PROMPT,
  buildIngestPrompt,
  createMainTools,
  discoveryAgentAsTool,
  type AgentStep,
  type EmbedFn,
} from '@wf/agent-tools';

export interface MainPipelineContext {
  db: Db;
  sandbox: SandboxRunner;
  /** Host directory mounted read-only at /docs inside the sandbox. */
  docsSnapshotDir: string;
  jobId: string;
  embed: EmbedFn;
  model: LanguageModel;
  embeddingModel: string;
  preview?: boolean;
  /** Hard step cap to prevent runaway loops (default 12). */
  stepLimit?: number;
  prompts?: Partial<RuntimeConfig['prompts']>;
  agentParams?: Partial<RuntimeConfig['agentParams']>;
  /** Progress callback fired after each agent step (wired to SSE). */
  onStep?: (step: unknown) => void | Promise<void>;
  /** Audit callback for jobs.agentSteps. */
  recordStep?: (step: AgentStep) => void | Promise<void>;
}

export interface MainPipelineResult {
  documentId: string;
  status: 'REVIEW' | 'PREVIEW';
  draftMarkdown: string;
  changeSummary: string;
  /** False when the agent never produced a tool_merge draft (original kept as a fallback). */
  merged: boolean;
}

/** Pull the most recent tool_merge output out of the agent's step history. */
export function extractMergeResult(
  steps: ReadonlyArray<{ toolResults?: ReadonlyArray<{ toolName: string; output: unknown }> }>,
): MergeResult | undefined {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const toolResults = steps[i]?.toolResults ?? [];
    for (const toolResult of toolResults) {
      if (toolResult.toolName === 'tool_merge') {
        const parsed = MergeResultSchema.safeParse(toolResult.output);
        if (parsed.success) return parsed.data;
      }
    }
  }
  return undefined;
}

/**
 * Runs the real Vercel AI SDK agent loop: the agent autonomously uses the search/sandbox/merge/verify
 * tools to produce a REVIEW draft for the ingested document.
 */
export async function runMainPipeline(
  documentId: string,
  ctx: MainPipelineContext,
): Promise<MainPipelineResult> {
  const documents = createDocumentsRepo(ctx.db);
  const doc = await documents.getById(documentId);
  if (!doc) throw new Error(`Document not found: ${documentId}`);

  const tools = createMainTools({
    db: ctx.db,
    sandbox: ctx.sandbox,
    docsSnapshotDir: ctx.docsSnapshotDir,
    jobId: ctx.jobId,
    documentId,
    embed: ctx.embed,
    model: ctx.model,
    ...(ctx.prompts ? { prompts: ctx.prompts } : {}),
    ...(ctx.agentParams ? { agentParams: ctx.agentParams } : {}),
    ...(ctx.recordStep ? { recordStep: ctx.recordStep } : {}),
  });
  const composedTools = {
    ...tools,
    tool_discovery_agent: discoveryAgentAsTool({
      jobId: ctx.jobId,
      model: ctx.model,
      tools,
      ...(ctx.prompts ? { prompts: ctx.prompts } : {}),
      ...(ctx.agentParams ? { agentParams: ctx.agentParams } : {}),
      ...(ctx.recordStep ? { recordStep: ctx.recordStep } : {}),
    }),
  };

  const agent = new ToolLoopAgent({
    model: ctx.model,
    instructions: ctx.prompts?.main ?? MAIN_AGENT_SYSTEM_PROMPT,
    tools: composedTools,
    stopWhen: stepCountIs(ctx.stepLimit ?? ctx.agentParams?.mainStepLimit ?? DEFAULT_AGENT_PARAMS.mainStepLimit),
  });

  const result = await agent.generate({
    prompt: buildIngestPrompt(doc),
    ...(ctx.onStep ? { onStepFinish: ctx.onStep } : {}),
  });

  const mergeResult = extractMergeResult(result.steps);
  const merged: MergeResult = mergeResult ?? {
    mergedMarkdown: doc.contentMarkdown,
    changeSummary: `⚠️ 자동 병합 미완료: ${result.text.trim() || '병합 도구가 호출되지 않아 원본을 유지했습니다.'}`,
  };

  if (ctx.preview) {
    await documents.setPreviewDraft(documentId, merged.mergedMarkdown);
  } else {
    await documents.setDraft(documentId, merged.mergedMarkdown); // status -> REVIEW
  }
  return {
    documentId,
    status: ctx.preview ? 'PREVIEW' : 'REVIEW',
    draftMarkdown: merged.mergedMarkdown,
    changeSummary: merged.changeSummary,
    merged: mergeResult !== undefined,
  };
}
