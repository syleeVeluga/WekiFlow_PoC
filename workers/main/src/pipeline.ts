import { createHash } from 'node:crypto';
import { ToolLoopAgent, stepCountIs, type LanguageModel } from 'ai';
import type { Db } from 'mongodb';
import { createChunksRepo, createDocumentsRepo } from '@wf/db';
import { MergeResultSchema, chunkMarkdown, type MergeResult } from '@wf/shared';
import type { SandboxRunner } from '@wf/sandbox';
import {
  MAIN_AGENT_SYSTEM_PROMPT,
  buildIngestPrompt,
  createMainTools,
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
  /** Hard step cap to prevent runaway loops (default 12). */
  stepLimit?: number;
  /** Progress callback fired after each agent step (wired to SSE). */
  onStep?: (step: unknown) => void | Promise<void>;
  /** Audit callback for jobs.agentSteps. */
  recordStep?: (step: AgentStep) => void | Promise<void>;
}

export interface MainPipelineResult {
  documentId: string;
  status: 'REVIEW';
  draftMarkdown: string;
  changeSummary: string;
  /** False when the agent never produced a tool_merge draft (original kept as a fallback). */
  merged: boolean;
}

/**
 * Chunk + embed the document content into `chunks` so tool_search_vector has something to search.
 * Skips re-embedding (a live model call) when the content + embedding model are unchanged since the
 * last run, keyed by a stored content signature.
 */
export async function indexDocumentChunks(
  db: Db,
  embed: EmbedFn,
  documentId: string,
  markdown: string,
  embeddingModel: string,
): Promise<number> {
  const chunks = chunkMarkdown(markdown);
  if (chunks.length === 0) return 0;
  const repo = createChunksRepo(db);
  const signature = createHash('sha256').update(`${embeddingModel}\n${markdown}`).digest('hex');
  if ((await repo.getSignature(documentId)) === signature) return chunks.length; // unchanged → skip re-embed
  const embeddings = await embed(chunks.map((chunk) => chunk.text));
  await repo.replaceForDocument(
    documentId,
    chunks.map((chunk, index) => ({
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
      tokens: chunk.tokens,
      headingPath: chunk.headingPath,
      embedding: embeddings[index] ?? [],
      embeddingModel,
    })),
    signature,
  );
  return chunks.length;
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

  await indexDocumentChunks(ctx.db, ctx.embed, documentId, doc.contentMarkdown, ctx.embeddingModel);

  const tools = createMainTools({
    db: ctx.db,
    sandbox: ctx.sandbox,
    docsSnapshotDir: ctx.docsSnapshotDir,
    jobId: ctx.jobId,
    documentId,
    embed: ctx.embed,
    model: ctx.model,
    ...(ctx.recordStep ? { recordStep: ctx.recordStep } : {}),
  });

  const agent = new ToolLoopAgent({
    model: ctx.model,
    instructions: MAIN_AGENT_SYSTEM_PROMPT,
    tools,
    stopWhen: stepCountIs(ctx.stepLimit ?? 12),
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

  await documents.setDraft(documentId, merged.mergedMarkdown); // status -> REVIEW
  return {
    documentId,
    status: 'REVIEW',
    draftMarkdown: merged.mergedMarkdown,
    changeSummary: merged.changeSummary,
    merged: mergeResult !== undefined,
  };
}
