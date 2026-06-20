import { z } from 'zod';
import type { CandidateProvenance } from '@wf/shared';

export const connectorKinds = ['slack', 'google_drive', 'meeting', 'upload', 'url'] as const;
export const ConnectorKindSchema = z.enum(connectorKinds);
export type ConnectorKind = z.infer<typeof ConnectorKindSchema>;

export const ConnectorCapabilitySchema = z.enum([
  'list',
  'fetch',
  'conversation',
  'file',
  'url',
]);
export type ConnectorCapability = z.infer<typeof ConnectorCapabilitySchema>;

export const SourceRefSchema = z.object({
  kind: ConnectorKindSchema,
  ref: z.string().min(1),
  title: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const SourceItemSchema = SourceRefSchema.extend({
  updatedAt: z.string().optional(),
  summary: z.string().optional(),
});
export type SourceItem = z.infer<typeof SourceItemSchema>;

export interface SourceFetchResult {
  ref: SourceRef;
  text: string;
  metadata: Record<string, unknown>;
  provenance: CandidateProvenance;
}

export interface SourceConnector {
  readonly kind: ConnectorKind;
  readonly capabilities: readonly ConnectorCapability[];
  list(options?: { limit?: number }): Promise<SourceItem[]>;
  fetch(ref: SourceRef | string): Promise<SourceFetchResult>;
}

export const ConnectorConfigSchema = z.object({
  slack: z.object({
    botToken: z.string().optional().default(''),
    signingSecret: z.string().optional().default(''),
  }).default({ botToken: '', signingSecret: '' }),
  googleDrive: z.object({
    clientId: z.string().optional().default(''),
    clientSecret: z.string().optional().default(''),
    refreshToken: z.string().optional().default(''),
  }).default({ clientId: '', clientSecret: '', refreshToken: '' }),
  meeting: z.object({
    transcriptBucket: z.string().optional().default(''),
  }).default({ transcriptBucket: '' }),
  url: z.object({
    allowlist: z.array(z.string()).optional().default([]),
  }).default({ allowlist: [] }),
});

export type ConnectorConfig = z.infer<typeof ConnectorConfigSchema>;

export function normalizeRef(kind: ConnectorKind, ref: SourceRef | string): SourceRef {
  return typeof ref === 'string' ? { kind, ref } : ref;
}
