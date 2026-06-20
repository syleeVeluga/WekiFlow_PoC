import { describe, expect, it } from 'vitest';
import { decideDisposition, detectRiskFactors } from './disposition.js';

describe('decideDisposition', () => {
  it('creates when no existing match is strong', () => {
    expect(decideDisposition({ sourceText: 'general onboarding note' })).toMatchObject({
      action: 'create',
      status: 'AI_ORGANIZED',
      riskFactors: [],
    });
  });

  it('enhances strong but non-duplicate matches', () => {
    expect(
      decideDisposition({
        sourceText: 'policy update',
        existingMatches: [{ documentId: 'doc-1', score: 0.82 }],
      }),
    ).toMatchObject({
      action: 'enhance',
      targetDocId: 'doc-1',
      status: 'NEEDS_APPROVAL',
      riskFactors: ['policy'],
    });
  });

  it('skips duplicate matches', () => {
    expect(
      decideDisposition({
        sourceText: 'same text',
        existingMatches: [{ documentId: 'doc-1', score: 0.99, sameContent: true }],
      }),
    ).toMatchObject({ action: 'skip', status: 'AI_ORGANIZED' });
  });

  it('preserves source-only inputs and detects conflicts', () => {
    expect(
      decideDisposition({
        sourceText: 'security source',
        preserveSourceOnly: true,
        existingMatches: [{ documentId: 'doc-2', score: 0.8, conflicting: true }],
      }),
    ).toMatchObject({
      action: 'source_only',
      status: 'CONFLICTED',
      riskFactors: ['security', 'conflict'],
      conflictWith: ['doc-2'],
    });
  });
});

describe('detectRiskFactors', () => {
  it('maps policy-sensitive words to candidate risks', () => {
    expect(detectRiskFactors('official answer about contract pricing')).toEqual([
      'contract',
      'pricing',
      'official_answer',
    ]);
  });
});
