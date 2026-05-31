import { generateObject, type LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { Db } from 'mongodb';
import { createDocumentsRepo, indexDocumentChunks, upsertTriplets } from '@wf/db';
import { TripletArraySchema, chunkMarkdown, type DocChunk, type EmbedFn, type Env, type Triplet } from '@wf/shared';

export const LIGHTRAG_EXTRACT_PROMPT = `You are a knowledge graph extractor.
Analyze the document chunk and return explicit (Subject)-[Predicate]->(Object) triplets only.

Rules:
1. Resolve pronouns or vague references to the concrete noun used in the text.
2. Include a strength score from 0 to 1 for each relation.
3. Classify subjectType and objectType, for example PERSON, DEPT, REGULATION, POLICY, ENTITY, DATE, or AMOUNT.
4. Extract only facts directly stated in the text. Do not infer or invent facts.
5. Prefer concise, stable entity names that can be matched across chunks.`;

export interface TripletModel {
  label: string;
  model: LanguageModel;
}

export type TripletExtractor = (chunk: DocChunk) => Promise<{ triplets: Triplet[]; modelLabel?: string }>;

export function createTripletExtractionModels(env: Env): TripletModel[] {
  const models: TripletModel[] = [];

  if (env.GOOGLE_API_KEY) {
    const google = createGoogleGenerativeAI({ apiKey: env.GOOGLE_API_KEY });
    models.push({ label: `google:${env.TRIPLET_GOOGLE_MODEL}`, model: google(env.TRIPLET_GOOGLE_MODEL) });
  }

  if (env.ANTHROPIC_API_KEY) {
    const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
    models.push({ label: `anthropic:${env.TRIPLET_ANTHROPIC_MODEL}`, model: anthropic(env.TRIPLET_ANTHROPIC_MODEL) });
  }

  if (env.OPENAI_API_KEY) {
    const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
    models.push({ label: `openai:${env.TRIPLET_OPENAI_FALLBACK_MODEL}`, model: openai(env.TRIPLET_OPENAI_FALLBACK_MODEL) });
  }

  return models;
}

export interface GraphPipelineContext {
  db: Db;
  model?: LanguageModel;
  models?: TripletModel[];
  extractTriplets?: TripletExtractor;
  embed?: EmbedFn;
  embeddingModel?: string;
  persist?: boolean;
  maxChunks?: number;
  recordStep?: (step: {
    tool: string;
    args: unknown;
    result?: unknown;
    tookMs?: number;
  }) => void | Promise<void>;
}

export interface GraphPipelineResult {
  documentId: string;
  status: 'GRAPH_INDEXED' | 'PREVIEW';
  chunkCount: number;
  tripletCount: number;
  triplets: Triplet[];
}

function dedupeTriplets(triplets: Triplet[]): Triplet[] {
  const byKey = new Map<string, Triplet>();

  for (const triplet of triplets) {
    const key = [
      triplet.subject.trim().toLowerCase(),
      triplet.predicate.trim().toLowerCase(),
      triplet.object.trim().toLowerCase(),
    ].join('\u0000');
    const existing = byKey.get(key);
    if (!existing || triplet.strength > existing.strength) {
      byKey.set(key, triplet);
    }
  }

  return [...byKey.values()];
}

function createDefaultExtractor(models: TripletModel[]): TripletExtractor {
  return async (chunk) => {
    const errors: string[] = [];

    for (const candidate of models) {
      try {
        const { object } = await generateObject({
          model: candidate.model,
          schema: TripletArraySchema,
          system: LIGHTRAG_EXTRACT_PROMPT,
          prompt: chunk.text,
        });
        return { ...object, modelLabel: candidate.label };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${candidate.label}: ${message}`);
      }
    }

    throw new Error(`Triplet extraction failed for all configured models. ${errors.join(' | ')}`);
  };
}

export async function runGraphPipeline(
  documentId: string,
  ctx: GraphPipelineContext,
): Promise<GraphPipelineResult> {
  const documents = createDocumentsRepo(ctx.db);
  const doc = await documents.getById(documentId);
  if (!doc) throw new Error(`Document not found: ${documentId}`);

  const models = ctx.models ?? (ctx.model ? [{ label: 'default', model: ctx.model }] : []);
  const extractor = ctx.extractTriplets ?? (models.length > 0 ? createDefaultExtractor(models) : undefined);
  if (!extractor) throw new Error('Graph pipeline requires a model or extractTriplets override');

  const persist = ctx.persist ?? true;
  const allChunks = chunkMarkdown(doc.contentMarkdown);
  const chunks = allChunks.slice(0, ctx.maxChunks ?? allChunks.length);
  const extracted: Triplet[] = [];

  for (const chunk of chunks) {
    const started = Date.now();
    const extraction = await extractor(chunk);
    const parsed = TripletArraySchema.parse(extraction);
    extracted.push(...parsed.triplets);
    await ctx.recordStep?.({
      tool: 'tool_extract_triplets',
      args: { documentId, chunkIndex: chunk.chunkIndex, headingPath: chunk.headingPath },
      result: { tripletCount: parsed.triplets.length, model: extraction.modelLabel },
      tookMs: Date.now() - started,
    });
  }

  const triplets = dedupeTriplets(extracted);
  if (persist) {
    // Ordering note: triplets → embed → markGraphIndexed. If embed throws, the job fails before
    // markGraphIndexed, leaving triplets persisted. This is safe to retry: upsertTriplets is keyed
    // (nodes by normalizedName, edges by subject/predicate/object) with $addToSet/$max, and
    // indexDocumentChunks skips re-embedding unchanged content via its stored signature — so a retry
    // is idempotent and recovers the partial state without duplicating data.
    const started = Date.now();
    await upsertTriplets(ctx.db, triplets, documentId);
    await ctx.recordStep?.({
      tool: 'graph_upsert_triplets',
      args: { documentId },
      result: { tripletCount: triplets.length },
      tookMs: Date.now() - started,
    });

    if (!ctx.embed || !ctx.embeddingModel) {
      throw new Error('Graph pipeline persist requires embed and embeddingModel');
    }
    const embedStarted = Date.now();
    const indexedChunkCount = await indexDocumentChunks(
      ctx.db,
      ctx.embed,
      documentId,
      doc.contentMarkdown,
      ctx.embeddingModel,
    );
    await ctx.recordStep?.({
      tool: 'graph_index_chunks',
      args: { documentId, embeddingModel: ctx.embeddingModel },
      result: { chunkCount: indexedChunkCount },
      tookMs: Date.now() - embedStarted,
    });

    await documents.markGraphIndexed(documentId);
  } else {
    await ctx.recordStep?.({
      tool: 'graph_preview_triplets',
      args: { documentId, chunkCount: chunks.length, capped: chunks.length < allChunks.length },
      result: { tripletCount: triplets.length },
    });
  }

  return {
    documentId,
    status: persist ? 'GRAPH_INDEXED' : 'PREVIEW',
    chunkCount: chunks.length,
    tripletCount: triplets.length,
    triplets,
  };
}
