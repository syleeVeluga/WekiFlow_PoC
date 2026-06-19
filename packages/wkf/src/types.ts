import { z } from 'zod';

export const RECOMMENDED_TYPES = [
  'REGULATION',
  'POLICY',
  'PLAYBOOK',
  'METRIC',
  'ENTITY',
  'DATASET',
  'PERSON',
  'DEPT',
] as const;

export const SourceTierSchema = z.enum(['official', 'internal', 'external', 'unverified']);

export const WkfDocumentStatusSchema = z.enum([
  'DRAFT',
  'PROCESSING',
  'REVIEW',
  'PUBLISHED',
  'GRAPH_INDEXED',
  'FAILED',
]);

export const FrontmatterSchema = z
  .object({
    type: z.string().trim().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    resource: z.string().optional(),
    tags: z.array(z.string()).default([]),
    timestamp: z.string().datetime().optional(),
    source_tier: SourceTierSchema.optional(),
    freshness: z.string().optional(),
    last_verified: z.string().datetime().optional(),
    status: WkfDocumentStatusSchema.optional(),
    slug: z.string().optional(),
  })
  .passthrough();

export const TripletSchema = z.object({
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  strength: z.number().min(0).max(1).optional(),
  ref: z.string().optional(),
});

export type RecommendedType = (typeof RECOMMENDED_TYPES)[number];
export type SourceTier = z.infer<typeof SourceTierSchema>;
export type WkfDocumentStatus = z.infer<typeof WkfDocumentStatusSchema>;
export type Frontmatter = z.infer<typeof FrontmatterSchema>;
export type Triplet = z.infer<typeof TripletSchema>;

export interface WkfDoc {
  frontmatter: Frontmatter;
  body: string;
}

export interface MongoWkfDocument {
  title?: unknown;
  slug?: unknown;
  status?: unknown;
  contentMarkdown?: unknown;
  sourceRefs?: unknown;
}
