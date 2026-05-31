import { generateObject, type LanguageModel } from 'ai';
import type { Db } from 'mongodb';
import { createDocumentsRepo, upsertTriplets } from '@wf/db';
import { TripletArraySchema, chunkMarkdown, type DocChunk, type Triplet } from '@wf/shared';

export const LIGHTRAG_EXTRACT_PROMPT = `You are a knowledge graph extractor.
Analyze the document chunk and return explicit (Subject)-[Predicate]->(Object) triplets only.

Rules:
1. Resolve pronouns or vague references to the concrete noun used in the text.
2. Include a strength score from 0 to 1 for each relation.
3. Classify subjectType and objectType, for example PERSON, DEPT, REGULATION, POLICY, ENTITY, DATE, or AMOUNT.
4. Extract only facts directly stated in the text. Do not infer or invent facts.
5. Prefer concise, stable entity names that can be matched across chunks.`;

export type TripletExtractor = (chunk: DocChunk) => Promise<{ triplets: Triplet[] }>;

export interface GraphPipelineContext {
  db: Db;
  model?: LanguageModel;
  extractTriplets?: TripletExtractor;
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

function createDefaultExtractor(model: LanguageModel): TripletExtractor {
  return async (chunk) => {
    const { object } = await generateObject({
      model,
      schema: TripletArraySchema,
      system: LIGHTRAG_EXTRACT_PROMPT,
      prompt: chunk.text,
    });
    return object;
  };
}

export async function runGraphPipeline(
  documentId: string,
  ctx: GraphPipelineContext,
): Promise<GraphPipelineResult> {
  const documents = createDocumentsRepo(ctx.db);
  const doc = await documents.getById(documentId);
  if (!doc) throw new Error(`Document not found: ${documentId}`);

  const extractor = ctx.extractTriplets ?? (ctx.model ? createDefaultExtractor(ctx.model) : undefined);
  if (!extractor) throw new Error('Graph pipeline requires a model or extractTriplets override');

  const persist = ctx.persist ?? true;
  const allChunks = chunkMarkdown(doc.contentMarkdown);
  const chunks = allChunks.slice(0, ctx.maxChunks ?? allChunks.length);
  const extracted: Triplet[] = [];

  for (const chunk of chunks) {
    const started = Date.now();
    const parsed = TripletArraySchema.parse(await extractor(chunk));
    extracted.push(...parsed.triplets);
    await ctx.recordStep?.({
      tool: 'tool_extract_triplets',
      args: { documentId, chunkIndex: chunk.chunkIndex, headingPath: chunk.headingPath },
      result: { tripletCount: parsed.triplets.length },
      tookMs: Date.now() - started,
    });
  }

  const triplets = dedupeTriplets(extracted);
  if (persist) {
    const started = Date.now();
    await upsertTriplets(ctx.db, triplets, documentId);
    await ctx.recordStep?.({
      tool: 'graph_upsert_triplets',
      args: { documentId },
      result: { tripletCount: triplets.length },
      tookMs: Date.now() - started,
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
