import { z } from 'zod';

export const DepartmentSchema = z.enum(['총무팀', '인사팀', 'IT팀', '재무팀', '영업팀', '미분류']);
export const ReviewPrioritySchema = z.enum(['p0', 'p1', 'p2']);
export const ChangeTypeSchema = z.enum(['conflict', 'update', 'new']);
export const CertaintySchema = z.number().int().min(1).max(5);
export const SourceAuthoritySchema = z.enum(['L1', 'L2', 'L3', 'L4']);
export const SourceChannelTypeSchema = z.enum(['slack', 'email', 'notion', 'manual', 'datasource']);
export const MultiSourceTypeSchema = z.enum(['A', 'B', 'C', 'D']);
export const KnowledgeFreshnessSchema = z.enum(['latest', 'needs_update', 'conflict']);
export const TopicSourceSchema = z.enum(['system', 'user']);
export const ActivityActorSchema = z.enum(['user', 'ai', 'conflict']);
export const ActivityKindSchema = z.enum(['create', 'edit', 'detect']);

export type Department = z.infer<typeof DepartmentSchema>;
export type ReviewPriority = z.infer<typeof ReviewPrioritySchema>;
export type ChangeType = z.infer<typeof ChangeTypeSchema>;
export type Certainty = z.infer<typeof CertaintySchema>;
export type SourceAuthority = z.infer<typeof SourceAuthoritySchema>;
export type SourceChannelType = z.infer<typeof SourceChannelTypeSchema>;
export type MultiSourceType = z.infer<typeof MultiSourceTypeSchema>;
export type KnowledgeFreshness = z.infer<typeof KnowledgeFreshnessSchema>;
export type TopicSource = z.infer<typeof TopicSourceSchema>;
export type ActivityActor = z.infer<typeof ActivityActorSchema>;
export type ActivityKind = z.infer<typeof ActivityKindSchema>;
