import { generateObject, type LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { Db } from 'mongodb';
import { createDocumentsRepo, indexDocumentChunks, upsertTriplets } from '@wf/db';
import { TagClassificationSchema, TripletArraySchema, chunkMarkdown, type DocChunk, type EmbedFn, type Env, type Triplet } from '@wf/shared';

export const LIGHTRAG_EXTRACT_PROMPT = `You are a knowledge graph extractor.
Analyze the document chunk and return explicit (Subject)-[Predicate]->(Object) triplets only.

Rules:
1. Resolve pronouns or vague references to the concrete noun used in the text.
2. Include a strength score from 0 to 1 for each relation.
3. Classify subjectType and objectType, for example PERSON, DEPT, REGULATION, POLICY, ENTITY, DATE, or AMOUNT.
4. Extract only facts directly stated in the text. Do not infer or invent facts.
5. Prefer concise, stable entity names that can be matched across chunks.`;

export const TAG_CLASSIFY_PROMPT = `You are a knowledge document classifier.
Read the document and return 2 to 4 short Korean topic tags that best represent it.

Rules:
1. Prefer reusing tags from the provided existing tag list whenever one fits the document.
2. Only invent a new tag when no existing tag is a good fit. Keep new tags concise (1-3 words).
3. Tags describe the document's subject/category, not individual entities or facts.
4. Return Korean tags. Do not duplicate tags.`;

export interface TripletModel {
  label: string;
  model: LanguageModel;
}

export type TripletExtractor = (chunk: DocChunk) => Promise<{ triplets: Triplet[]; modelLabel?: string }>;

export type TagClassifier = (
  content: string,
  knownTags: string[],
) => Promise<{ tags: string[]; modelLabel?: string }>;

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
  classifyTags?: TagClassifier;
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

const TAG_CLASSIFY_MAX_CHARS = 8000;
const TAG_CLASSIFY_MAX_KNOWN_TAGS = 100;
const TAG_CLASSIFY_MAX_VOCAB_CHARS = 2000;

export function formatKnownTagVocabulary(knownTags: string[]): string {
  const tags: string[] = [];
  const seen = new Set<string>();
  let chars = 0;

  for (const raw of knownTags) {
    const tag = raw.trim();
    if (!tag || seen.has(tag)) continue;
    if (tag.length > TAG_CLASSIFY_MAX_VOCAB_CHARS) continue;
    const separatorChars = tags.length > 0 ? 2 : 0;
    const nextChars = chars + separatorChars + tag.length;
    if (tags.length >= TAG_CLASSIFY_MAX_KNOWN_TAGS || nextChars > TAG_CLASSIFY_MAX_VOCAB_CHARS) break;
    seen.add(tag);
    tags.push(tag);
    chars = nextChars;
  }

  return tags.length > 0 ? tags.join(', ') : '(none yet)';
}

function createTagClassifier(models: TripletModel[]): TagClassifier {
  return async (content, knownTags) => {
    const text = content.slice(0, TAG_CLASSIFY_MAX_CHARS);
    const vocabulary = formatKnownTagVocabulary(knownTags);
    const prompt = `Existing tags (reuse when they fit): ${vocabulary}\n\nDocument:\n${text}`;
    const errors: string[] = [];

    for (const candidate of models) {
      try {
        const { object } = await generateObject({
          model: candidate.model,
          schema: TagClassificationSchema,
          system: TAG_CLASSIFY_PROMPT,
          prompt,
        });
        return { tags: object.tags, modelLabel: candidate.label };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${candidate.label}: ${message}`);
      }
    }

    throw new Error(`Tag classification failed for all configured models. ${errors.join(' | ')}`);
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
  const classifyTags = ctx.classifyTags ?? (models.length > 0 ? createTagClassifier(models) : undefined);

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

    // Best-effort AI tag classification. Tags are auxiliary (triplets are the primary deliverable),
    // so a failure here must not fail the job — log the step and move on. Reuses existing tag
    // vocabulary to avoid tag sprawl, and unions via addWikiTags so manual/prior tags are preserved.
    if (classifyTags) {
      const tagStarted = Date.now();
      try {
        const knownTags = await documents.listKnownTags();
        const classification = await classifyTags(doc.contentMarkdown, knownTags);
        const tags = TagClassificationSchema.parse({ tags: classification.tags }).tags;
        await documents.addWikiTags(documentId, tags);
        await ctx.recordStep?.({
          tool: 'graph_classify_tags',
          args: { documentId, knownTagCount: knownTags.length },
          result: { tags, model: classification.modelLabel },
          tookMs: Date.now() - tagStarted,
        });
      } catch (error) {
        await ctx.recordStep?.({
          tool: 'graph_classify_tags',
          args: { documentId },
          result: { error: error instanceof Error ? error.message : String(error) },
          tookMs: Date.now() - tagStarted,
        });
      }
    }
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
