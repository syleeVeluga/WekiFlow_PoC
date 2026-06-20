import { describe, expect, it } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import { LEARNER_JUDGE_PROMPT, judgeTrajectory, redactPii, summarizeSteps } from './learner.js';

function systemPrompt(call: unknown): unknown {
  return (call as { prompt?: Array<{ role: string; content: unknown }> }).prompt?.find((message) => message.role === 'system')?.content;
}

describe('learner tools', () => {
  it('redacts PII from trajectory summaries', () => {
    expect(redactPii('user test@example.com phone 010-1234-5678 id 123456789')).toBe(
      'user [REDACTED] phone [REDACTED] id [REDACTED]',
    );
  });

  it('summarizes agent steps for judge input', () => {
    const summary = summarizeSteps([{ tool: 'tool_verify_integrity', args: { claims: ['A'] }, result: { allVerified: false } }]);
    expect(summary).toContain('tool_verify_integrity');
    expect(summary).toContain('allVerified');
  });

  it('returns schema-valid enrichment proposals from the judge model', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              proposals: [
                {
                  gapType: 'MISSING_CITATION',
                  targetSlug: 'hr/leave',
                  instruction: 'Add missing citation for [REDACTED].',
                  evidence: { reasoning: 'verify failed', stepQuote: 'tool_verify_integrity allVerified=false' },
                  priority: 2,
                  evalCandidate: { valid: true, intent: 'leave question', goldenAnswer: '15 days' },
                },
              ],
            }),
          },
        ],
        finishReason: 'stop',
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: [],
      },
    } as never);

    const result = await judgeTrajectory({
      model,
      jobId: 'job-1',
      steps: [{ tool: 'tool_verify_integrity', args: {}, result: { allVerified: false } }],
    });

    expect(result.proposals[0]).toMatchObject({ gapType: 'MISSING_CITATION', targetSlug: 'hr/leave' });
  });

  it('uses learner judge prompt overrides and preserves the constant fallback', async () => {
    const response = {
      content: [{ type: 'text', text: JSON.stringify({ proposals: [] }) }],
      finishReason: 'stop',
      usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
      warnings: [],
    } as const;
    const steps = [{ tool: 'tool_verify_integrity', args: {}, result: { allVerified: true } }];
    const model = new MockLanguageModelV3({ doGenerate: response } as never);

    await judgeTrajectory({
      model,
      jobId: 'job-override',
      steps,
      prompts: { learnerJudge: 'LEARNER JUDGE OVERRIDE' },
    });

    expect(systemPrompt(model.doGenerateCalls[0])).toBe('LEARNER JUDGE OVERRIDE');

    const fallbackModel = new MockLanguageModelV3({ doGenerate: response } as never);
    await judgeTrajectory({ model: fallbackModel, jobId: 'job-fallback', steps });
    expect(systemPrompt(fallbackModel.doGenerateCalls[0])).toBe(LEARNER_JUDGE_PROMPT);
  });
});
