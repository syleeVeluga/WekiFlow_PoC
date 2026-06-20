import { ToolLoopAgent, stepCountIs, type LanguageModel } from 'ai';
import type { Db } from 'mongodb';
import { createCandidateRepository, createDocumentsRepo } from '@wf/db';
import {
  DEFAULT_AGENT_PARAMS,
  MergeResultSchema,
  type CandidateProvenance,
  type KnowledgeCandidate,
  type MergeResult,
  type RuntimeConfig,
} from '@wf/shared';
import type { SandboxRunner } from '@wf/sandbox';
import {
  MAIN_AGENT_SYSTEM_PROMPT,
  buildIngestPrompt,
  createMainTools,
  discoveryAgentAsTool,
  DispositionResultSchema,
  type DispositionResult,
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
  status: 'REVIEW' | 'PREVIEW' | 'SKIPPED' | 'SOURCE_ONLY';
  draftMarkdown: string;
  changeSummary: string;
  /** False when the agent never produced a tool_merge draft (original kept as a fallback). */
  merged: boolean;
  disposition?: DispositionResult;
  candidate?: KnowledgeCandidate;
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

/** Pull the most recent tool_decide_disposition output out of the agent's step history. */
export function extractCandidateResult(
  steps: ReadonlyArray<{ toolResults?: ReadonlyArray<{ toolName: string; output: unknown }> }>,
): DispositionResult | undefined {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const toolResults = steps[i]?.toolResults ?? [];
    for (const toolResult of toolResults) {
      if (toolResult.toolName === 'tool_decide_disposition') {
        const parsed = DispositionResultSchema.safeParse(toolResult.output);
        if (parsed.success) return parsed.data;
      }
    }
  }
  return undefined;
}

function provenanceForDisposition(doc: { id: string; title: string }, disposition: DispositionResult): CandidateProvenance {
  return {
    kind: disposition.action === 'source_only' ? 'manual' : 'file',
    ref: `document://${doc.id}`,
    label: doc.title,
    ...(disposition.action === 'source_only' ? { needsSource: true } : {}),
  };
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
  const candidates = createCandidateRepository(ctx.db);
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
  const disposition = extractCandidateResult(result.steps);
  const merged: MergeResult = mergeResult ?? {
    mergedMarkdown: doc.contentMarkdown,
    changeSummary: `⚠️ 자동 병합 미완료: ${result.text.trim() || '병합 도구가 호출되지 않아 원본을 유지했습니다.'}`,
  };

  const shouldWriteDraft = !disposition || disposition.action === 'create' || disposition.action === 'enhance';
  const shouldWriteCandidate = !ctx.preview && disposition && disposition.action !== 'skip';
  const candidate = shouldWriteCandidate
    ? await candidates.createCandidate({
        title: doc.title,
        summary: merged.changeSummary,
        bodyMarkdown: disposition.action === 'source_only' ? doc.contentMarkdown : merged.mergedMarkdown,
        status: disposition.status,
        riskFactors: disposition.riskFactors,
        provenance: provenanceForDisposition(doc, disposition),
        linkedDocId: disposition.targetDocId ?? doc.id,
        conflictWith: disposition.conflictWith,
      })
    : undefined;

  if (ctx.preview) {
    await documents.setPreviewDraft(documentId, merged.mergedMarkdown);
  } else if (shouldWriteDraft) {
    await documents.setDraft(documentId, merged.mergedMarkdown); // status -> REVIEW
  } else {
    await documents.reject(documentId); // source-only/skip keeps the original as DRAFT, not official knowledge.
  }
  return {
    documentId,
    status: ctx.preview ? 'PREVIEW' : disposition?.action === 'skip' ? 'SKIPPED' : disposition?.action === 'source_only' ? 'SOURCE_ONLY' : 'REVIEW',
    draftMarkdown: merged.mergedMarkdown,
    changeSummary: merged.changeSummary,
    merged: mergeResult !== undefined,
    ...(disposition ? { disposition } : {}),
    ...(candidate ? { candidate } : {}),
  };
}
