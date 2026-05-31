import { z } from 'zod';
import { DepartmentSchema } from './wiki/enums.js';

export const documentStatuses = [
  'DRAFT',
  'PROCESSING',
  'PREVIEW',
  'REVIEW',
  'PUBLISHED',
  'GRAPH_INDEXED',
  'FAILED',
] as const;

export const userRoles = ['OWNER', 'APPROVER', 'REVIEWER', 'EDITOR', 'VIEWER'] as const;
export const jobQueues = ['main', 'graph'] as const;
export const jobTypes = ['INGEST', 'MERGE', 'EXTRACT_TRIPLETS', 'PREVIEW'] as const;

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

/** A human-readable fact extracted from this document (subject → predicate → object). */
export const ConnectionFactSchema = z.object({
  subject: z.string(),
  predicate: z.string(),
  object: z.string(),
  strength: z.number().min(0).max(1),
});
export type ConnectionFact = z.infer<typeof ConnectionFactSchema>;

/** Another document that shares entities with the current one, plus how it connects. */
export const RelatedDocSchema = z.object({
  documentId: z.string(),
  title: z.string(),
  sharedEntities: z.array(z.string()).default([]),
  via: z
    .array(z.object({ entity: z.string(), predicate: z.string() }))
    .default([]),
});
export type RelatedDoc = z.infer<typeof RelatedDocSchema>;

/** "연결 관계" payload: this doc's facts + related documents discovered via shared entities. */
export const DocumentConnectionsSchema = z.object({
  facts: z.array(ConnectionFactSchema).default([]),
  relatedDocs: z.array(RelatedDocSchema).default([]),
});
export type DocumentConnections = z.infer<typeof DocumentConnectionsSchema>;

/** A document currently in the trash (soft-deleted). */
export const TrashEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string().optional(),
  trashedAt: z.string(),
});
export type TrashEntry = z.infer<typeof TrashEntrySchema>;

export const AgentStepPhaseSchema = z.enum(['main', 'graph']);

export const AgentStepSchema = z.object({
  tool: z.string(),
  args: z.unknown(),
  result: z.unknown().optional(),
  tookMs: z.number().int().nonnegative().optional(),
  phase: AgentStepPhaseSchema.optional(),
  createdAt: z.string().optional(),
});

export type AgentStepDTO = z.infer<typeof AgentStepSchema>;

export const AgentPreviewRequestSchema = z.object({
  message: z.string().min(1),
  title: z.string().min(1).optional(),
  commit: z.boolean().optional().default(false),
});

export type AgentPreviewRequest = z.infer<typeof AgentPreviewRequestSchema>;

export const AppSettingsSchema = z.object({
  reviewApprovalEnabled: z.boolean().default(false),
});

export const UpdateAppSettingsSchema = AppSettingsSchema.partial();

export type AppSettings = z.infer<typeof AppSettingsSchema>;
export type UpdateAppSettings = z.infer<typeof UpdateAppSettingsSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  reviewApprovalEnabled: false,
};

export const IngestRequestSchema = z.object({
  title: z.string().min(1),
  contentMarkdown: z.string().optional().default(''),
  parentId: z.string().nullable().optional(),
  topic: z.string().min(1).optional(),
  workspace: z.string().min(1).optional(),
  /** Legacy ingest clients may still send department; new direct-add UI sends workspace. */
  department: DepartmentSchema.optional(),
  sourceLabel: z.string().min(1).optional(),
});

export type IngestRequest = z.infer<typeof IngestRequestSchema>;

/** Builds the `sourceRefs[].note` string recorded for a manual/file ingest. */
export function ingestSourceNote(input: { topic?: string; workspace?: string; department?: string; sourceLabel?: string }): string {
  const workspace = input.workspace ?? input.department;
  return [
    input.topic ? `topic=${input.topic}` : null,
    workspace ? `workspace=${workspace}` : null,
    input.sourceLabel ? `source=${input.sourceLabel}` : null,
  ]
    .filter((part): part is string => part != null)
    .join('; ');
}

export const AgentPreviewResultSchema = z.object({
  documentId: z.string(),
  /** The extracted source text the agent merged against — used as the diff base on the client. */
  originalMarkdown: z.string(),
  draftMarkdown: z.string(),
  changeSummary: z.string(),
  merged: z.boolean(),
  triplets: z.array(TripletSchema),
  chunkCount: z.number().int().nonnegative(),
  tripletCount: z.number().int().nonnegative(),
  committed: z.boolean().optional(),
});

export type AgentPreviewResult = z.infer<typeof AgentPreviewResultSchema>;

export const AgentPreviewStatusSchema = z.enum(['queued', 'active', 'completed', 'failed', 'unknown']);

export const AgentPreviewRunSchema = z.object({
  jobId: z.string(),
  documentId: z.string(),
  title: z.string().optional(),
  status: AgentPreviewStatusSchema,
  steps: z.array(AgentStepSchema),
  result: AgentPreviewResultSchema.optional(),
  error: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type AgentPreviewRun = z.infer<typeof AgentPreviewRunSchema>;

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

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

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
  TRIPLET_GOOGLE_MODEL: z.string().default('gemini-3.1-flash-lite'),
  TRIPLET_ANTHROPIC_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  TRIPLET_OPENAI_FALLBACK_MODEL: z.string().default('gpt-5.4-nano'),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  DOCKER_SOCKET: z.string().default('//./pipe/docker_engine'),
  VECTOR_SEARCH_MODE: z.enum(['app-cosine', 'atlas']).default('app-cosine'),
  ADMIN_EMAIL: z.string().default('admin01@veluga.io'),
  ADMIN_PASSWORD: z.string().default('admin01@veluga.io'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(input);
}

// --- Roles & permissions (cumulative ladder) ---
// 소유자(OWNER) > 승인(APPROVER) > 검토(REVIEWER) > 편집(EDITOR) > 보기(VIEWER).
// 검토(REVIEWER)는 검토·반려까지, 최종 승인은 승인(APPROVER) 이상만 가능하다.
// 소유자·승인 권한자가 사용자별로 역할을 선택·부여한다.
const roleRank: Record<UserRole, number> = { OWNER: 5, APPROVER: 4, REVIEWER: 3, EDITOR: 2, VIEWER: 1 };

export const roleLabels: Record<UserRole, string> = {
  OWNER: '소유자',
  APPROVER: '승인',
  REVIEWER: '검토',
  EDITOR: '편집',
  VIEWER: '보기',
};

/** 편집·문서 등록 가능 (편집 이상). */
export function canEdit(role: UserRole): boolean {
  return roleRank[role] >= roleRank.EDITOR;
}

/** 변경사항 검토·반려 가능 (검토 이상). */
export function canReview(role: UserRole): boolean {
  return roleRank[role] >= roleRank.REVIEWER;
}

/** 최종 승인 가능 (승인 이상). 검토는 승인 불가. */
export function canApprove(role: UserRole): boolean {
  return roleRank[role] >= roleRank.APPROVER;
}

/** 사용자 관리(역할 부여 등) 가능 (승인 + 소유자). */
export function canManageUsers(role: UserRole): boolean {
  return roleRank[role] >= roleRank.APPROVER;
}

/** 소유자 역할 부여/회수·소유자 계정 변경은 소유자만 가능. */
export function canManageOwners(role: UserRole): boolean {
  return role === 'OWNER';
}

// --- User & auth (Phase: 로그인/사용자 관리) ---
export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  role: UserRoleSchema,
  createdAt: z.string(),
});
export type User = z.infer<typeof UserSchema>;

export const LoginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginBody = z.infer<typeof LoginBodySchema>;

export const AuthResultSchema = z.object({ token: z.string(), user: UserSchema });
export type AuthResult = z.infer<typeof AuthResultSchema>;

export const CreateUserBodySchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: UserRoleSchema,
});
export type CreateUserBody = z.infer<typeof CreateUserBodySchema>;

export const UpdateUserRoleBodySchema = z.object({ role: UserRoleSchema });
export type UpdateUserRoleBody = z.infer<typeof UpdateUserRoleBodySchema>;

// 데모 사용자 — 기존 시드 작성자 이름 기반. 비밀번호는 이메일과 동일하게 시드된다.
// 소유자(OWNER)는 .env(ADMIN_EMAIL)에서 별도로 시드된다.
export const seedDemoUsers: Array<{ name: string; email: string; role: UserRole }> = [
  { name: '이지수', email: 'lee.jisoo@veluga.io', role: 'APPROVER' },
  { name: '박민지', email: 'park.minji@veluga.io', role: 'REVIEWER' },
  { name: '김도윤', email: 'kim.doyoon@veluga.io', role: 'EDITOR' },
  { name: '최서연', email: 'choi.seoyeon@veluga.io', role: 'VIEWER' },
  { name: '한준호', email: 'han.junho@veluga.io', role: 'REVIEWER' },
];

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
