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
export const jobQueues = ['main', 'graph', 'curation', 'learner'] as const;
export const jobTypes = ['INGEST', 'MERGE', 'EXTRACT_TRIPLETS', 'PREVIEW', 'SCAN_STALE', 'CURATE_CONCEPT', 'LEARN_TRAJECTORY'] as const;

export const DocumentStatusSchema = z.enum(documentStatuses);
export const UserRoleSchema = z.enum(userRoles);
export const JobQueueSchema = z.enum(jobQueues);
export const JobTypeSchema = z.enum(jobTypes);

export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;
export type UserRole = z.infer<typeof UserRoleSchema>;
export type JobQueue = z.infer<typeof JobQueueSchema>;
export type JobType = z.infer<typeof JobTypeSchema>;

export const SourceRefSchema = z.object({
  type: z.enum(['upload', 'datasource', 'manual', 'api']),
  ref: z.string(),
  note: z.string().default(''),
});

export type SourceRef = z.infer<typeof SourceRefSchema>;

export const IngestionInfoSchema = z.object({
  userId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  sourceName: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  idempotencyScope: z.string().min(1).optional(),
  contentType: z.string().min(1).optional(),
  sourceLabel: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  jobId: z.string().min(1).optional(),
  receivedAt: z.string().optional(),
});

export type IngestionInfo = z.infer<typeof IngestionInfoSchema>;

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
  ingestion: IngestionInfoSchema.optional(),
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

export const TagClassificationSchema = z.object({
  tags: z.array(z.string().min(1)).min(2).max(4),
});

export type TagClassification = z.infer<typeof TagClassificationSchema>;

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

export const promptKeys = ['main', 'curation', 'merge', 'discoveryDecompose', 'discoverySystem', 'learnerJudge'] as const;
export const PromptKeySchema = z.enum(promptKeys);
export type PromptKey = z.infer<typeof PromptKeySchema>;

export const DEFAULT_RUNTIME_PROMPTS: Record<PromptKey, string> = {
  main: `너는 WekiFlow의 지식 병합 에이전트다. 목표는 인입된 정보를 기존 문서에 정확히 병합하는 것이다.
원칙:
1) 절대 추측하지 마라. 수치·규정번호·고유명사가 불확실하면 tool_execute_sandbox_terminal로 rg/grep을 실행해 원본(/docs)에서 직접 확인하라.
2) 의미적 맥락은 tool_search_vector로, 규정 간 관계는 tool_search_graph로 보강하라.
3) 충분한 팩트가 모이면 tool_merge로 병합 초안을 만들어라.
4) 병합 후 반드시 tool_verify_integrity로 핵심 주장(수치/조항)을 자가 검증하라. 미검증 항목이 있으면 다시 grep으로 확인 후 수정하라.
5) 최종 결과는 사람이 Monaco Diff로 검토할 것이므로 변경 요약(changeSummary)을 남겨라.
도구는 필요할 때만, 최소 횟수로 호출하라.

Phase 4 retrieval guide:
- For relationship questions, start with tool_search_graph or tool_hybrid_retrieve using the most concrete startEntity in the user/document text.
- Prefer tool_hybrid_retrieve when both semantically similar chunks and knowledge-graph paths are useful; it returns RRF-ranked context from vector and graph retrieval.
- If graph paths are sparse, fall back to tool_search_vector and finally tool_execute_sandbox_terminal for exact clauses, numbers, and policy wording.
- Pass graph path facts into tool_merge as evidence when they explain relationships across documents.`,
  curation: `You are WekiFlow's knowledge curation agent. Keep the assigned concept current without destructive rewrites.

Rules:
1. First read the concept and its read-only reference context with tool_read_concept.
2. Verify source facts with tool_grep_verify before deciding. If the source facts are unchanged, do not rewrite the document; call tool_write_concept with decision "verify".
3. If facts changed, only produce additive updates. Preserve existing frontmatter keys, keep type/title/resource verbatim, union tags, and preserve every existing # heading in the same order and wording.
4. If the topic does not clearly belong in the existing concept, use decision "create" only when the new reference is concrete, non-meta, citeable, and reusable. Otherwise use decision "skip".
5. For external web sources, call tool_fetch_url. The tool enforces allowed_hosts and web_max_pages. Do not retry rejected URLs.
6. When in doubt, skip. Only cite sources that were actually read or verified.`,
  merge: `너는 사내 지식 문서 편집기다. 기존 문서(original)에 수집된 팩트(facts)를 정확히 병합한 마크다운 초안을 만든다.
규칙:
1) facts에 명시된 수치·조항·고유명사를 그대로 사용하고, 근거 없는 내용을 창작하지 마라.
2) 기존 문서의 구조와 어조를 유지하되, 신규 정보를 적절한 섹션에 통합하라.
3) mergedMarkdown에는 완성된 문서 전문을, changeSummary에는 무엇이 어떻게 바뀌었는지 한국어 요약을 담아라.`,
  discoveryDecompose: `Break the user's question into retrieval queries.
Return the original question as baseline and at most three non-duplicate variants.
Variants should cover synonyms, narrower entities, or Korean/English terminology when useful.
Do not invent facts or filters.`,
  discoverySystem: `You are WekiFlow's Discovery Q&A agent.
Answer only from retrieved WekiFlow context.
First use tool_hybrid_retrieve for the user's question. Use graph or sandbox tools only when exact relations or wording need verification.
Return concise answers with supporting document ids or paths when available.
If context is insufficient, say what is missing instead of guessing.`,
  learnerJudge: `You are WekiFlow's trajectory judge.
Review jobs.agentSteps and propose only concrete, evidence-backed WKF enrichment tasks.
Map signals as follows:
- failed tool_verify_integrity or unverified claims => FAILED_VERIFICATION or MISSING_CITATION.
- graph retrieval with empty paths for a relationship question => MISSING_RELATION.
- weak vector/hybrid retrieval scores => LOW_RETRIEVAL_SCORE.
- sandbox grep found useful facts outside the target document => OFF_TREE_HIT.
Quote the relevant step. Redact email addresses, phone numbers, and long numeric identifiers with [REDACTED].
If there is no actionable gap, return an empty proposals array.
Successful question-answer traces may include evalCandidate for regression goldens.`,
};

export const DEFAULT_AGENT_PARAMS = {
  mainStepLimit: 12,
  discoveryStepLimit: 8,
  curationStepLimit: 12,
  vectorK: 8,
  hybridK: 8,
  graphMaxDepth: 2,
  sandboxTimeoutMs: 10_000,
} as const;

const RuntimePromptsSchema = z.object({
  main: z.string().min(1).optional(),
  curation: z.string().min(1).optional(),
  merge: z.string().min(1).optional(),
  discoveryDecompose: z.string().min(1).optional(),
  discoverySystem: z.string().min(1).optional(),
  learnerJudge: z.string().min(1).optional(),
});

const RuntimePromptPatchSchema = z.object({
  main: z.string().min(1).nullable().optional(),
  curation: z.string().min(1).nullable().optional(),
  merge: z.string().min(1).nullable().optional(),
  discoveryDecompose: z.string().min(1).nullable().optional(),
  discoverySystem: z.string().min(1).nullable().optional(),
  learnerJudge: z.string().min(1).nullable().optional(),
});

const RuntimeAgentParamsSchema = z.object({
  mainStepLimit: z.number().int().min(1).max(50).optional(),
  discoveryStepLimit: z.number().int().min(1).max(50).optional(),
  curationStepLimit: z.number().int().min(1).max(50).optional(),
  vectorK: z.number().int().min(1).max(50).optional(),
  hybridK: z.number().int().min(1).max(20).optional(),
  graphMaxDepth: z.number().int().min(1).max(3).optional(),
  sandboxTimeoutMs: z.number().int().min(1_000).max(30_000).optional(),
});

const RuntimeAgentParamsPatchSchema = z.object({
  mainStepLimit: z.number().int().min(1).max(50).nullable().optional(),
  discoveryStepLimit: z.number().int().min(1).max(50).nullable().optional(),
  curationStepLimit: z.number().int().min(1).max(50).nullable().optional(),
  vectorK: z.number().int().min(1).max(50).nullable().optional(),
  hybridK: z.number().int().min(1).max(20).nullable().optional(),
  graphMaxDepth: z.number().int().min(1).max(3).nullable().optional(),
  sandboxTimeoutMs: z.number().int().min(1_000).max(30_000).nullable().optional(),
});

const RuntimeModelsSchema = z.object({
  agentModel: z.string().min(1).optional(),
  embeddingModel: z.string().min(1).optional(),
  tripletGoogleModel: z.string().min(1).optional(),
  tripletAnthropicModel: z.string().min(1).optional(),
  tripletOpenAiFallbackModel: z.string().min(1).optional(),
});

const RuntimeModelsPatchSchema = z.object({
  agentModel: z.string().min(1).nullable().optional(),
  embeddingModel: z.string().min(1).nullable().optional(),
  tripletGoogleModel: z.string().min(1).nullable().optional(),
  tripletAnthropicModel: z.string().min(1).nullable().optional(),
  tripletOpenAiFallbackModel: z.string().min(1).nullable().optional(),
});

export const RuntimeConfigSchema = z.object({
  prompts: RuntimePromptsSchema.default({}),
  agentParams: RuntimeAgentParamsSchema.default({}),
  models: RuntimeModelsSchema.default({}),
  policy: z.record(z.string(), z.unknown()).nullable().default(null),
});

export const RuntimeConfigPatchSchema = z.object({
  prompts: RuntimePromptPatchSchema.optional(),
  agentParams: RuntimeAgentParamsPatchSchema.optional(),
  models: RuntimeModelsPatchSchema.optional(),
  policy: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
export type RuntimeConfigPatch = z.infer<typeof RuntimeConfigPatchSchema>;

export const RuntimeConfigResponseSchema = z.object({
  defaults: RuntimeConfigSchema,
  overrides: RuntimeConfigSchema,
  effective: RuntimeConfigSchema,
});
export type RuntimeConfigResponse = z.infer<typeof RuntimeConfigResponseSchema>;

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

export const ExternalIngestionRequestSchema = z.object({
  sourceName: z.string().min(1).max(200),
  idempotencyKey: z.string().min(1).max(512).optional(),
  contentType: z.string().min(1).default('text/plain'),
  titleHint: z.string().min(1).optional(),
  topic: z.string().min(1).optional(),
  sourceLabel: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  rawPayload: z.object({
    text: z.string().min(1),
  }),
});

export type ExternalIngestionRequest = z.infer<typeof ExternalIngestionRequestSchema>;

export function buildIngestionIdempotencyScope(input: {
  userId?: string | undefined;
  workspaceId?: string | undefined;
  sourceName?: string | undefined;
  idempotencyKey?: string | undefined;
}): string | undefined {
  // The scope is owner-bound (userId) so two callers can reuse the same idempotencyKey without
  // colliding — a replay must never surface another user's document.
  const userId = input.userId?.trim();
  const workspaceId = input.workspaceId?.trim();
  const sourceName = input.sourceName?.trim();
  const idempotencyKey = input.idempotencyKey?.trim();
  return userId && workspaceId && sourceName && idempotencyKey
    ? [userId, workspaceId, sourceName, idempotencyKey].join('\u0000')
    : undefined;
}

/** Builds the `sourceRefs[].note` string recorded for a manual/file ingest. */
export function ingestSourceNote(input: {
  topic?: string;
  workspace?: string;
  department?: string;
  sourceLabel?: string;
  sourceName?: string;
  idempotencyKey?: string;
  contentType?: string;
}): string {
  const workspace = input.workspace ?? input.department;
  return [
    input.topic ? `topic=${input.topic}` : null,
    workspace ? `workspace=${workspace}` : null,
    input.sourceLabel ? `source=${input.sourceLabel}` : null,
    input.sourceName ? `sourceName=${input.sourceName}` : null,
    input.idempotencyKey ? `idempotencyKey=${input.idempotencyKey}` : null,
    input.contentType ? `contentType=${input.contentType}` : null,
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
  MAIN_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  GRAPH_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  MAIN_QUEUE_RATE_MAX: z.coerce.number().int().nonnegative().default(30),
  MAIN_QUEUE_RATE_DURATION_MS: z.coerce.number().int().positive().default(60_000),
  GRAPH_QUEUE_RATE_MAX: z.coerce.number().int().nonnegative().default(60),
  GRAPH_QUEUE_RATE_DURATION_MS: z.coerce.number().int().positive().default(60_000),
  CURATION_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(1),
  CURATION_QUEUE_RATE_MAX: z.coerce.number().int().nonnegative().default(30),
  CURATION_QUEUE_RATE_DURATION_MS: z.coerce.number().int().positive().default(60_000),
  LEARNER_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(1),
  LEARNER_QUEUE_RATE_MAX: z.coerce.number().int().nonnegative().default(30),
  LEARNER_QUEUE_RATE_DURATION_MS: z.coerce.number().int().positive().default(60_000),
  WKF_BUNDLE_PATH: z.string().min(1).optional(),
  ADMIN_EMAIL: z.string().default('admin01@veluga.io'),
  ADMIN_PASSWORD: z.string().default('admin01@veluga.io'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(input);
}

export function createDefaultRuntimeConfig(env: Pick<
  Env,
  'AGENT_MODEL' | 'EMBEDDING_MODEL' | 'TRIPLET_GOOGLE_MODEL' | 'TRIPLET_ANTHROPIC_MODEL' | 'TRIPLET_OPENAI_FALLBACK_MODEL'
>): RuntimeConfig {
  return {
    prompts: { ...DEFAULT_RUNTIME_PROMPTS },
    agentParams: { ...DEFAULT_AGENT_PARAMS },
    models: {
      agentModel: env.AGENT_MODEL,
      embeddingModel: env.EMBEDDING_MODEL,
      tripletGoogleModel: env.TRIPLET_GOOGLE_MODEL,
      tripletAnthropicModel: env.TRIPLET_ANTHROPIC_MODEL,
      tripletOpenAiFallbackModel: env.TRIPLET_OPENAI_FALLBACK_MODEL,
    },
    policy: null,
  };
}

export function mergeRuntimeConfig(defaults: RuntimeConfig, overrides: RuntimeConfig): RuntimeConfig {
  return RuntimeConfigSchema.parse({
    prompts: { ...defaults.prompts, ...overrides.prompts },
    agentParams: { ...defaults.agentParams, ...overrides.agentParams },
    models: { ...defaults.models, ...overrides.models },
    policy: overrides.policy ?? defaults.policy,
  });
}

function mergeNullableSection<T extends Record<string, unknown>>(
  current: T,
  patch: Record<string, unknown | null> | undefined,
): T {
  if (!patch) return current;
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  return next as T;
}

export function mergeRuntimeConfigPatch(current: RuntimeConfig, patch: RuntimeConfigPatch): RuntimeConfig {
  return RuntimeConfigSchema.parse({
    prompts: mergeNullableSection(current.prompts, patch.prompts),
    agentParams: mergeNullableSection(current.agentParams, patch.agentParams),
    models: mergeNullableSection(current.models, patch.models),
    policy: patch.policy === undefined ? current.policy : patch.policy,
  });
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

/** Dev control panel access is orthogonal to the role ladder. */
export function canAccessDevPanel(user: { isSuperAdmin?: boolean }): boolean {
  return user.isSuperAdmin === true;
}

// --- User & auth (Phase: 로그인/사용자 관리) ---
export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  role: UserRoleSchema,
  isSuperAdmin: z.boolean().optional().default(false),
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
  isSuperAdmin: z.boolean().optional().default(false),
});
export type CreateUserBody = z.infer<typeof CreateUserBodySchema>;

export const UpdateUserRoleBodySchema = z.object({
  role: UserRoleSchema,
  isSuperAdmin: z.boolean().optional(),
});
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
