import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { AgentStepDTO } from '@wf/shared';

export const LearnerGapTypeSchema = z.enum([
  'MISSING_CITATION',
  'MISSING_RELATION',
  'LOW_RETRIEVAL_SCORE',
  'FAILED_VERIFICATION',
  'OFF_TREE_HIT',
]);

export const WkfEnrichmentProposalSchema = z.object({
  gapType: LearnerGapTypeSchema,
  targetSlug: z.string().min(1).nullable(),
  instruction: z.string().min(1),
  evidence: z.object({
    reasoning: z.string().min(1),
    stepQuote: z.string().min(1),
  }),
  priority: z.number().int().min(1).max(5).default(3),
  evalCandidate: z.object({
    valid: z.boolean(),
    intent: z.string().nullable(),
    goldenAnswer: z.string().nullable(),
  }),
});

export const TrajectoryAnalysisResultSchema = z.object({
  proposals: z.array(WkfEnrichmentProposalSchema),
});

export type WkfEnrichmentProposal = z.infer<typeof WkfEnrichmentProposalSchema>;
export type TrajectoryAnalysisResult = z.infer<typeof TrajectoryAnalysisResultSchema>;

export const LEARNER_JUDGE_PROMPT = `You are WekiFlow's trajectory judge.
Review jobs.agentSteps and propose only concrete, evidence-backed WKF enrichment tasks.
Map signals as follows:
- failed tool_verify_integrity or unverified claims => FAILED_VERIFICATION or MISSING_CITATION.
- graph retrieval with empty paths for a relationship question => MISSING_RELATION.
- weak vector/hybrid retrieval scores => LOW_RETRIEVAL_SCORE.
- sandbox grep found useful facts outside the target document => OFF_TREE_HIT.
Quote the relevant step. Redact email addresses, phone numbers, and long numeric identifiers with [REDACTED].
If there is no actionable gap, return an empty proposals array.
Successful question-answer traces may include evalCandidate for regression goldens.`;

export function redactPii(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED]')
    .replace(/\b\d{3}[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, '[REDACTED]')
    .replace(/\b\d{8,}\b/g, '[REDACTED]');
}

export function summarizeSteps(steps: AgentStepDTO[], maxChars = 8_000): string {
  return redactPii(
    steps
      .map((step, index) => {
        const result = step.result == null ? '' : ` result=${JSON.stringify(step.result)}`;
        return `${index + 1}. tool=${step.tool} args=${JSON.stringify(step.args)}${result}`;
      })
      .join('\n')
      .slice(0, maxChars),
  );
}

export async function judgeTrajectory(input: {
  model: LanguageModel;
  jobId: string;
  steps: AgentStepDTO[];
}): Promise<TrajectoryAnalysisResult> {
  if (input.steps.length === 0) return { proposals: [] };
  const { object } = await generateObject({
    model: input.model,
    schema: TrajectoryAnalysisResultSchema,
    system: LEARNER_JUDGE_PROMPT,
    prompt: `Job: ${input.jobId}\n\n${summarizeSteps(input.steps)}`,
  });
  return {
    proposals: object.proposals.map((proposal) => ({
      ...proposal,
      instruction: redactPii(proposal.instruction),
      evidence: {
        reasoning: redactPii(proposal.evidence.reasoning),
        stepQuote: redactPii(proposal.evidence.stepQuote),
      },
      evalCandidate: {
        valid: proposal.evalCandidate.valid,
        intent: proposal.evalCandidate.intent ? redactPii(proposal.evalCandidate.intent) : null,
        goldenAnswer: proposal.evalCandidate.goldenAnswer ? redactPii(proposal.evalCandidate.goldenAnswer) : null,
      },
    })),
  };
}
