import { z } from 'zod';
import { CandidateStatusSchema, RiskFactorSchema, type CandidateStatus, type RiskFactor } from '@wf/shared';

export const DispositionActionSchema = z.enum(['create', 'enhance', 'skip', 'source_only']);
export type DispositionAction = z.infer<typeof DispositionActionSchema>;

export const ExistingMatchSchema = z.object({
  documentId: z.string().min(1),
  score: z.number().min(0).max(1).default(0),
  sameContent: z.boolean().optional().default(false),
  conflicting: z.boolean().optional().default(false),
});
export type ExistingMatch = z.infer<typeof ExistingMatchSchema>;
export type ExistingMatchInput = z.input<typeof ExistingMatchSchema>;

export const DispositionResultSchema = z.object({
  action: DispositionActionSchema,
  status: CandidateStatusSchema,
  targetDocId: z.string().min(1).optional(),
  riskFactors: z.array(RiskFactorSchema).default([]),
  conflictWith: z.array(z.string()).default([]),
  reason: z.string().min(1),
});
export type DispositionResult = z.infer<typeof DispositionResultSchema>;

const riskPatterns: Array<[RiskFactor, RegExp]> = [
  ['policy', /policy|정책/i],
  ['regulation', /regulation|규정|조항/i],
  ['contract', /contract|계약/i],
  ['security', /security|보안/i],
  ['pricing', /price|pricing|가격/i],
  ['official_answer', /official answer|공식 답변/i],
  ['external_exposure', /external|public|외부|공개/i],
];

export function detectRiskFactors(text: string): RiskFactor[] {
  return riskPatterns.flatMap(([risk, pattern]) => (pattern.test(text) ? [risk] : []));
}

function candidateStatus(input: {
  action: DispositionAction;
  riskFactors: RiskFactor[];
  conflictWith: string[];
  sourceOnly: boolean;
}): CandidateStatus {
  if (input.conflictWith.length > 0 || input.riskFactors.includes('conflict')) return 'CONFLICTED';
  if (input.sourceOnly) return 'NEEDS_CHECK';
  if (input.riskFactors.length > 0) return 'NEEDS_APPROVAL';
  return input.action === 'enhance' ? 'SOURCE_VERIFIED' : 'AI_ORGANIZED';
}

export function decideDisposition(input: {
  sourceText: string;
  existingMatches?: ExistingMatchInput[];
  riskFactors?: RiskFactor[];
  preserveSourceOnly?: boolean;
}): DispositionResult {
  const matches = z.array(ExistingMatchSchema).parse(input.existingMatches ?? []);
  const top = matches.toSorted((a, b) => b.score - a.score)[0];
  const conflictWith = matches.filter((match) => match.conflicting).map((match) => match.documentId);
  const riskFactors = [...new Set([...(input.riskFactors ?? detectRiskFactors(input.sourceText)), ...(conflictWith.length ? ['conflict' as const] : [])])];

  let action: DispositionAction = 'create';
  let reason = 'No strong existing match; create a new candidate.';
  if (top?.sameContent || (top && top.score >= 0.98)) {
    action = 'skip';
    reason = 'Existing knowledge already covers the source.';
  } else if (input.preserveSourceOnly) {
    action = 'source_only';
    reason = 'Source should be preserved without knowledge synthesis.';
  } else if (top && top.score >= 0.72) {
    action = 'enhance';
    reason = 'Existing knowledge is close enough for an additive enhancement.';
  }

  return DispositionResultSchema.parse({
    action,
    status: candidateStatus({
      action,
      riskFactors,
      conflictWith,
      sourceOnly: action === 'source_only',
    }),
    ...(action === 'enhance' && top ? { targetDocId: top.documentId } : {}),
    riskFactors,
    conflictWith,
    reason,
  });
}
