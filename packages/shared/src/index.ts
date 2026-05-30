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
