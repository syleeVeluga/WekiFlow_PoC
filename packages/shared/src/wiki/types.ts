import { z } from 'zod';
import {
  ActivityActorSchema,
  ActivityKindSchema,
  CertaintySchema,
  ChangeTypeSchema,
  DepartmentSchema,
  KnowledgeFreshnessSchema,
  MultiSourceTypeSchema,
  SourceAuthoritySchema,
  SourceChannelTypeSchema,
  TopicSourceSchema,
} from './enums.js';

export const TopicSchema = z.object({
  id: z.string(),
  name: z.string(),
  source: TopicSourceSchema,
  isUnclassified: z.boolean().default(false),
  count: z.number().int().nonnegative().default(0),
});
export type Topic = z.infer<typeof TopicSchema>;

export const KnowledgeProvenanceSchema = z.object({
  label: z.string(),
  at: z.string(),
  by: z.string(),
  source: z.string(),
});
export type KnowledgeProvenance = z.infer<typeof KnowledgeProvenanceSchema>;

export const KnowledgeItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  contentMarkdown: z.string(),
  department: DepartmentSchema,
  category: z.string(),
  freshness: KnowledgeFreshnessSchema,
  usageCount: z.number().int().nonnegative(),
  modCount: z.number().int().nonnegative(),
  sourceLabel: z.string(),
  authorName: z.string(),
  updatedAtLabel: z.string(),
  aiTags: z.array(z.string()).default([]),
  origin: KnowledgeProvenanceSchema.optional(),
  lastChange: KnowledgeProvenanceSchema.optional(),
  documentId: z.string().optional(),
});
export type KnowledgeItem = z.infer<typeof KnowledgeItemSchema>;

export const AiTagSuggestionSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  itemTitle: z.string(),
  tag: z.string(),
  reason: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
});
export type AiTagSuggestion = z.infer<typeof AiTagSuggestionSchema>;

export const SourceMessageSchema = z.object({
  channel: z.string(),
  channelType: SourceChannelTypeSchema,
  icon: z.string().optional(),
  author: z.string(),
  time: z.string(),
  content: z.string(),
  isBaseline: z.boolean().optional(),
  authorityLevel: SourceAuthoritySchema.optional(),
  highlight: z.boolean().optional(),
});
export type SourceMessage = z.infer<typeof SourceMessageSchema>;

export const ReviewExistingSchema = z.object({
  content: z.string(),
  establishedAt: z.string(),
  by: z.string(),
  source: z.string(),
});
export type ReviewExisting = z.infer<typeof ReviewExistingSchema>;

export const DiffLineSchema = z.object({
  kind: z.enum(['add', 'del']),
  content: z.string(),
});
export type DiffLine = z.infer<typeof DiffLineSchema>;

export const ConflictThreadSchema = z.object({
  type: z.enum(['slack', 'email']),
  channel: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  subj: z.string().optional(),
  date: z.string(),
  messages: z.array(SourceMessageSchema).default([]),
  body: z.string().optional(),
});
export type ConflictThread = z.infer<typeof ConflictThreadSchema>;

export const ReviewSourceSchema = z.object({
  type: SourceChannelTypeSchema,
  channel: z.string(),
  time: z.string(),
  author: z.string(),
  authorityLevel: SourceAuthoritySchema,
});
export type ReviewSource = z.infer<typeof ReviewSourceSchema>;

export const ReviewItemSchema = z.object({
  id: z.string(),
  changeType: ChangeTypeSchema,
  certainty: CertaintySchema,
  department: DepartmentSchema,
  topicTitle: z.string(),
  source: ReviewSourceSchema,
  existing: ReviewExistingSchema.nullable().optional(),
  newValue: z.string(),
  newContent: z.string(),
  diff: z.array(DiffLineSchema).default([]),
  thread: ConflictThreadSchema,
  reason: z.string(),
  documentId: z.string().optional(),
  resolved: z.boolean().default(false),
});
export type ReviewItem = z.infer<typeof ReviewItemSchema>;

export const MultiSourceTargetSchema = z.object({
  id: z.string(),
  title: z.string(),
  current: z.string(),
  category: z.string(),
  selected: z.boolean().optional(),
});
export type MultiSourceTarget = z.infer<typeof MultiSourceTargetSchema>;

export const MultiSourceGroupSchema = z.object({
  id: z.string(),
  multiSourceType: MultiSourceTypeSchema,
  certainty: CertaintySchema,
  department: DepartmentSchema,
  topicTitle: z.string(),
  description: z.string(),
  sources: z.array(SourceMessageSchema),
  resolvedContent: z.string().nullable(),
  targets: z.array(MultiSourceTargetSchema),
  reason: z.string(),
  resolved: z.boolean().default(false),
});
export type MultiSourceGroup = z.infer<typeof MultiSourceGroupSchema>;

export const ActivityEntrySchema = z.object({
  id: z.string(),
  actor: ActivityActorSchema,
  actorLabel: z.string(),
  department: DepartmentSchema,
  kind: ActivityKindSchema,
  targetTitle: z.string(),
  time: z.string(),
  dateLabel: z.string().optional(),
});
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;

export const CoverageStatSchema = z.object({
  key: z.string(),
  label: z.string(),
  count: z.number().int().nonnegative(),
  role: z.string().optional(),
  tone: z.enum(['ok', 'warn', 'error']).optional(),
  flag: z.string().optional(),
});
export type CoverageStat = z.infer<typeof CoverageStatSchema>;

export const DigestEntityRefSchema = z.object({
  kind: z.enum(['conflict', 'new', 'update']),
  itemId: z.string(),
  title: z.string(),
  quote: z.string().optional(),
});
export type DigestEntityRef = z.infer<typeof DigestEntityRefSchema>;

export const DigestSectionSchema = z.object({
  title: z.string(),
  pill: z.string().optional(),
  tone: z.enum(['ok', 'warn', 'error', 'info']),
  entities: z.array(DigestEntityRefSchema),
});
export type DigestSection = z.infer<typeof DigestSectionSchema>;

export const DailyDigestSchema = z.object({
  dateLabel: z.string(),
  updatedAtLabel: z.string().optional(),
  leadCounts: z.object({
    detected: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
    toApply: z.number().int().nonnegative(),
  }),
  topSearch: z.string().optional(),
  sections: z.array(DigestSectionSchema),
  metrics: z.object({
    pendingReview: z.number().int().nonnegative(),
    todayNewCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    analysisCount: z.number().int().nonnegative(),
    extractedCount: z.number().int().nonnegative(),
    autoAppliedCount: z.number().int().nonnegative(),
    autoProcessingRate: z.number().int().min(0).max(100),
  }),
  mostAsked: z.array(CoverageStatSchema),
});
export type DailyDigest = z.infer<typeof DailyDigestSchema>;

export const TreeCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  source: TopicSourceSchema,
  items: z.array(KnowledgeItemSchema),
});
export type TreeCategory = z.infer<typeof TreeCategorySchema>;

export const KnowledgeQuerySchema = z.object({
  person: z.string().optional().default('all'),
  topic: z.string().optional().default('all'),
  tag: z.string().nullable().optional().default(null),
  status: z.string().optional().default('all'),
  q: z.string().optional().default(''),
  sort: z.enum(['uses', 'recent', 'alpha']).optional().default('uses'),
});
export type KnowledgeQuery = z.infer<typeof KnowledgeQuerySchema>;

export const MsResolveBodySchema = z.object({
  targetIds: z.array(z.string()).min(1),
  selectedVersion: z.string().optional(),
  content: z.string().optional(),
});
export type MsResolveBody = z.infer<typeof MsResolveBodySchema>;
