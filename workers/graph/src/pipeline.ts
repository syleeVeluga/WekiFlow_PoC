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
  recordStep?: (step: { tool: string; args: unknown; result?: unknown }) => void | Promise<void>;
}

export interface GraphPipelineResult {
  documentId: string;
  status: 'GRAPH_INDEXED';
  chunkCount: number;
  tripletCount: number;
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

  const chunks = chunkMarkdown(doc.contentMarkdown);
  const extracted: Triplet[] = [];

  for (const chunk of chunks) {
    const parsed = TripletArraySchema.parse(await extractor(chunk));
    extracted.push(...parsed.triplets);
    await ctx.recordStep?.({
      tool: 'tool_extract_triplets',
      args: { documentId, chunkIndex: chunk.chunkIndex, headingPath: chunk.headingPath },
      result: { tripletCount: parsed.triplets.length },
    });
  }

  const triplets = dedupeTriplets(extracted);
  await upsertTriplets(ctx.db, triplets, documentId);
  await ctx.recordStep?.({
    tool: 'graph_upsert_triplets',
    args: { documentId },
    result: { tripletCount: triplets.length },
  });

  await documents.markGraphIndexed(documentId);

  return {
    documentId,
    status: 'GRAPH_INDEXED',
    chunkCount: chunks.length,
    tripletCount: triplets.length,
  };
}
