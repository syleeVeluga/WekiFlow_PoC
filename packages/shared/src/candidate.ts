import { z } from 'zod';

export const candidateStatuses = [
  'AI_ORGANIZED',
  'SOURCE_VERIFIED',
  'NEEDS_CHECK',
  'NEEDS_APPROVAL',
  'PUBLISHED',
  'CONFLICTED',
] as const;

export const riskFactors = [
  'policy',
  'regulation',
  'contract',
  'security',
  'pricing',
  'official_answer',
  'no_source',
  'conflict',
  'external_exposure',
] as const;

export const CandidateStatusSchema = z.enum(candidateStatuses);
export const RiskFactorSchema = z.enum(riskFactors);
const CandidateDocumentStatusSchema = z.enum([
  'DRAFT',
  'PROCESSING',
  'PREVIEW',
  'REVIEW',
  'PUBLISHED',
  'GRAPH_INDEXED',
  'FAILED',
]);
type CandidateDocumentStatus = z.infer<typeof CandidateDocumentStatusSchema>;

export type CandidateStatus = z.infer<typeof CandidateStatusSchema>;
export type RiskFactor = z.infer<typeof RiskFactorSchema>;

export const CANDIDATE_STATUS_LABEL: Record<CandidateStatus, string> = {
  AI_ORGANIZED: 'AI 정리됨',
  SOURCE_VERIFIED: '출처 확인됨',
  NEEDS_CHECK: '확인 필요',
  NEEDS_APPROVAL: '승인 필요',
  PUBLISHED: '공식 지식',
  CONFLICTED: '충돌 있음',
};

export const CANDIDATE_TO_DOC_STATUS: Record<CandidateStatus, CandidateDocumentStatus> = {
  AI_ORGANIZED: 'DRAFT',
  SOURCE_VERIFIED: 'REVIEW',
  NEEDS_CHECK: 'REVIEW',
  NEEDS_APPROVAL: 'REVIEW',
  PUBLISHED: 'PUBLISHED',
  CONFLICTED: 'REVIEW',
};

export const DOC_STATUS_TO_CANDIDATE: Record<CandidateDocumentStatus, CandidateStatus> = {
  DRAFT: 'AI_ORGANIZED',
  PROCESSING: 'AI_ORGANIZED',
  PREVIEW: 'AI_ORGANIZED',
  REVIEW: 'NEEDS_APPROVAL',
  PUBLISHED: 'PUBLISHED',
  GRAPH_INDEXED: 'PUBLISHED',
  FAILED: 'NEEDS_CHECK',
};

export const CandidateProvenanceSchema = z
  .object({
    kind: z.enum(['file', 'url', 'datasource', 'conversation', 'manual']),
    ref: z.string().min(1),
    label: z.string().min(1).optional(),
    conversationQuote: z.string().min(1).optional(),
    speaker: z.string().min(1).optional(),
    createdFromConversation: z.boolean().optional(),
    needsSource: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .transform((value) => {
    if (value.kind !== 'conversation') return value;
    return {
      ...value,
      createdFromConversation: value.createdFromConversation ?? true,
      needsSource: value.needsSource ?? true,
    };
  });

export type CandidateProvenance = z.infer<typeof CandidateProvenanceSchema>;

export const CandidateTransitionSchema = z.object({
  from: CandidateStatusSchema,
  to: CandidateStatusSchema,
});

export type CandidateTransition = z.infer<typeof CandidateTransitionSchema>;

export const ALLOWED_CANDIDATE_TRANSITIONS: ReadonlyArray<CandidateTransition> = [
  { from: 'AI_ORGANIZED', to: 'SOURCE_VERIFIED' },
  { from: 'AI_ORGANIZED', to: 'NEEDS_CHECK' },
  { from: 'AI_ORGANIZED', to: 'NEEDS_APPROVAL' },
  { from: 'AI_ORGANIZED', to: 'CONFLICTED' },
  { from: 'AI_ORGANIZED', to: 'PUBLISHED' },
  { from: 'SOURCE_VERIFIED', to: 'NEEDS_APPROVAL' },
  { from: 'SOURCE_VERIFIED', to: 'CONFLICTED' },
  { from: 'SOURCE_VERIFIED', to: 'PUBLISHED' },
  { from: 'NEEDS_CHECK', to: 'SOURCE_VERIFIED' },
  { from: 'NEEDS_CHECK', to: 'NEEDS_APPROVAL' },
  { from: 'NEEDS_CHECK', to: 'CONFLICTED' },
  { from: 'NEEDS_APPROVAL', to: 'SOURCE_VERIFIED' },
  { from: 'NEEDS_APPROVAL', to: 'PUBLISHED' },
  { from: 'NEEDS_APPROVAL', to: 'CONFLICTED' },
  { from: 'CONFLICTED', to: 'NEEDS_CHECK' },
  { from: 'CONFLICTED', to: 'NEEDS_APPROVAL' },
];

const transitionKeys = new Set(ALLOWED_CANDIDATE_TRANSITIONS.map(({ from, to }) => `${from}:${to}`));

export function canTransitionCandidate(from: CandidateStatus, to: CandidateStatus): boolean {
  return from === to || transitionKeys.has(`${from}:${to}`);
}

export function defaultCandidateStatusForProvenance(provenance: CandidateProvenance): CandidateStatus {
  return provenance.kind === 'conversation' ? 'NEEDS_CHECK' : 'AI_ORGANIZED';
}

export const CandidateContractSchema = z.object({
  status: CandidateStatusSchema,
  riskFactors: z.array(RiskFactorSchema).default([]),
  provenance: CandidateProvenanceSchema,
  documentStatus: CandidateDocumentStatusSchema.optional(),
});

export type CandidateContract = z.infer<typeof CandidateContractSchema>;

export function needsReview(candidate: Pick<CandidateContract, 'riskFactors'>): boolean {
  return candidate.riskFactors.length > 0;
}

export function canAutoPublish(candidate: Pick<CandidateContract, 'status' | 'riskFactors' | 'provenance'>): boolean {
  return (
    !needsReview(candidate) &&
    (candidate.status === 'AI_ORGANIZED' || candidate.status === 'SOURCE_VERIFIED') &&
    candidate.provenance.kind !== 'conversation'
  );
}
