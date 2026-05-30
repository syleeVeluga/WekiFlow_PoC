import { z } from 'zod';

export const documentStatuses = [
  'DRAFT',
  'PROCESSING',
  'REVIEW',
  'PUBLISHED',
  'GRAPH_INDEXED',
  'FAILED',
] as const;

export const userRoles = ['ADMIN', 'REVIEWER', 'EDITOR', 'VIEWER'] as const;
export const jobQueues = ['main', 'graph'] as const;
export const jobTypes = ['INGEST', 'MERGE', 'EXTRACT_TRIPLETS'] as const;

export const DocumentStatusSchema = z.enum(documentStatuses);
export const UserRoleSchema = z.enum(userRoles);
export const JobQueueSchema = z.enum(jobQueues);
export const JobTypeSchema = z.enum(jobTypes);

export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;
export type UserRole = z.infer<typeof UserRoleSchema>;
export type JobQueue = z.infer<typeof JobQueueSchema>;
export type JobType = z.infer<typeof JobTypeSchema>;

export const SourceRefSchema = z.object({
  type: z.enum(['upload', 'datasource', 'manual']),
  ref: z.string(),
  note: z.string().default(''),
});

export const DocumentSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  parentId: z.string().nullable(),
  isFolder: z.boolean(),
  status: DocumentStatusSchema,
  contentMarkdown: z.string(),
  draftMarkdown: z.string().nullable(),
  version: z.number().int().min(1),
  sourceRefs: z.array(SourceRefSchema).default([]),
  createdBy: z.string().optional(),
  approvedBy: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type DocumentDTO = z.infer<typeof DocumentSchema>;

export const TreeNodeSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  title: z.string(),
  slug: z.string(),
  isFolder: z.boolean(),
  status: DocumentStatusSchema,
});

export type TreeNode = z.infer<typeof TreeNodeSchema>;

export const JobRefSchema = z.object({
  id: z.string(),
  type: JobTypeSchema,
  documentId: z.string(),
  createdAt: z.string(),
});

export type JobRef = z.infer<typeof JobRefSchema>;

export const TripletSchema = z.object({
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  subjectType: z.string().min(1),
  objectType: z.string().min(1),
  strength: z.number().min(0).max(1),
});

export const TripletArraySchema = z.object({
  triplets: z.array(TripletSchema),
});

export type Triplet = z.infer<typeof TripletSchema>;

export const SandboxRunResultSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int(),
  truncated: z.boolean(),
});

export type SandboxRunResult = z.infer<typeof SandboxRunResultSchema>;

// --- Agent tool I/O (Phase 2) ---

export const VectorHitSchema = z.object({
  text: z.string(),
  documentId: z.string(),
  headingPath: z.array(z.string()),
  score: z.number(),
});

export const VectorSearchResultSchema = z.object({
  results: z.array(VectorHitSchema),
});

export type VectorHit = z.infer<typeof VectorHitSchema>;

export const MergeResultSchema = z.object({
  mergedMarkdown: z.string(),
  changeSummary: z.string(),
});

export type MergeResult = z.infer<typeof MergeResultSchema>;

export const VerifyResultSchema = z.object({
  results: z.array(
    z.object({
      claim: z.string(),
      verified: z.boolean(),
      evidence: z.string(),
    }),
  ),
  allVerified: z.boolean(),
});

export type VerifyResult = z.infer<typeof VerifyResultSchema>;

export const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  MONGODB_URI: z.string().default('mongodb://localhost:27017'),
  MONGODB_DB: z.string().default('wekiflow'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().int().default(9000),
  MINIO_ACCESS_KEY: z.string().default('minioadmin'),
  MINIO_SECRET_KEY: z.string().default('minioadmin'),
  MINIO_USE_SSL: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  AGENT_MODEL: z.string().default('gpt-5.5'),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-large'),
  DOCKER_SOCKET: z.string().default('//./pipe/docker_engine'),
  VECTOR_SEARCH_MODE: z.enum(['app-cosine', 'atlas']).default('app-cosine'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(input);
}

export function canApprove(role: UserRole): boolean {
  return role === 'ADMIN' || role === 'REVIEWER';
}

export function normalizeEntityName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

export * from './wiki/index.js';

// --- Chunking (Phase 2 §5: heading-based + token cap with overlap) ---

export interface DocChunk {
  chunkIndex: number;
  text: string;
  tokens: number;
  headingPath: string[];
}

// Approximate token segmentation. A plain whitespace word count badly under-counts
// scriptio-continua languages (Korean/CJK rarely space between words), so a long Korean
// section would read as a handful of "words" and never window under the cap — risking
// chunks that blow past the embedding model's token limit. Here each CJK character counts
// as one token and every other whitespace-delimited run counts as one.
const CJK = '\\p{Script=Han}\\p{Script=Hangul}\\p{Script=Hiragana}\\p{Script=Katakana}';
const TOKEN_RE = new RegExp(`[${CJK}]|[^\\s${CJK}]+`, 'gu');

/** Token spans (start/end offsets into `text`) used for both counting and windowing. */
function tokenSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  for (const match of text.matchAll(TOKEN_RE)) {
    const start = match.index ?? 0;
    spans.push({ start, end: start + match[0].length });
  }
  return spans;
}

/** Approximate token count for a string (CJK-aware; see {@link chunkMarkdown}). */
export function estimateTokens(text: string): number {
  return tokenSpans(text).length;
}

/**
 * Splits markdown into heading-scoped chunks, further windowed to a token cap.
 * Token count is approximated CJK-aware (see {@link estimateTokens}) so Korean sections
 * window correctly. Heading-only sections (a heading with no body) are dropped — their
 * title still survives in the `headingPath` of descendant chunks.
 */
export function chunkMarkdown(
  markdown: string,
  options: { maxTokens?: number; overlap?: number } = {},
): DocChunk[] {
  const maxTokens = options.maxTokens ?? 512;
  const overlap = Math.min(options.overlap ?? 64, maxTokens - 1);
  const stride = Math.max(1, maxTokens - overlap);

  const isHeadingLine = (line: string) => /^#{1,6}\s+/.test(line);

  const sections: Array<{ headingPath: string[]; lines: string[] }> = [];
  const headingStack: Array<{ level: number; title: string }> = [];
  let current: { headingPath: string[]; lines: string[] } | null = null;

  const flush = () => {
    if (!current || current.lines.join('\n').trim().length === 0) return;
    // Drop sections that are nothing but their own heading (no body to retrieve on).
    const hasBody = current.lines.some((line) => !isHeadingLine(line) && line.trim().length > 0);
    if (current.headingPath.length > 0 && !hasBody) return;
    sections.push(current);
  };

  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      while (headingStack.length > 0 && headingStack[headingStack.length - 1]!.level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, title: heading[2]!.trim() });
      current = { headingPath: headingStack.map((h) => h.title), lines: [line] };
    } else {
      if (!current) current = { headingPath: [], lines: [] };
      current.lines.push(line);
    }
  }
  flush();

  const chunks: DocChunk[] = [];
  let chunkIndex = 0;
  for (const section of sections) {
    const text = section.lines.join('\n').trim();
    const spans = tokenSpans(text);
    if (spans.length <= maxTokens) {
      chunks.push({ chunkIndex: chunkIndex++, text, tokens: spans.length, headingPath: section.headingPath });
      continue;
    }
    for (let start = 0; start < spans.length; start += stride) {
      const window = spans.slice(start, start + maxTokens);
      // Slice the original substring across the window so spacing/formatting is preserved.
      const sliceText = text.slice(window[0]!.start, window[window.length - 1]!.end).trim();
      chunks.push({
        chunkIndex: chunkIndex++,
        text: sliceText,
        tokens: window.length,
        headingPath: section.headingPath,
      });
      if (start + maxTokens >= spans.length) break;
    }
  }
  return chunks;
}
