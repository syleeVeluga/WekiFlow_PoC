import { describe, expect, it } from 'vitest';
import type { KnowledgeCandidate } from '@wf/shared';
import { defaultPolicy, routeCandidate } from './index.js';

function candidate(input: Partial<KnowledgeCandidate>): KnowledgeCandidate {
  return {
    id: 'candidate-1',
    title: 'Candidate',
    summary: '',
    bodyMarkdown: '',
    status: 'AI_ORGANIZED',
    riskFactors: [],
    provenance: { kind: 'file', ref: 'file://policy.md' },
    linkedDocId: null,
    conflictWith: [],
    createdAt: '2026-06-21T00:00:00.000Z',
    updatedAt: '2026-06-21T00:00:00.000Z',
    ...input,
  };
}

describe('routeCandidate', () => {
  it('routes low-risk sourced candidates to auto publish', () => {
    expect(routeCandidate(candidate({ status: 'SOURCE_VERIFIED' })).action).toBe('auto_publish');
  });

  it('routes high-risk candidates to approval with policy roles', () => {
    const route = routeCandidate(candidate({ riskFactors: ['regulation'] }), defaultPolicy, { role: 'APPROVER' });
    expect(route).toMatchObject({
      action: 'needs_approval',
      reasons: ['regulation'],
      approverRoles: ['OWNER', 'APPROVER'],
      canApprove: true,
    });
  });

  it('does not widen type-specific approval overrides with generic risk factors', () => {
    const ownerOnlyRegulation = {
      ...defaultPolicy,
      review: { ...defaultPolicy.review, overrides: { REGULATION: ['OWNER'] } },
    };
    const route = routeCandidate(candidate({ riskFactors: ['regulation', 'official_answer'] }), ownerOnlyRegulation, { role: 'APPROVER' });
    expect(route).toMatchObject({
      action: 'needs_approval',
      approverRoles: ['OWNER'],
      canApprove: false,
    });
  });

  it('routes weak-source candidates to source confirmation before approval', () => {
    const route = routeCandidate(candidate({
      status: 'NEEDS_CHECK',
      riskFactors: ['official_answer', 'no_source'],
      provenance: { kind: 'conversation', ref: 'chat://1', needsSource: true, createdFromConversation: true },
    }));
    expect(route.action).toBe('needs_source');
    expect(route.reasons).toEqual(['official_answer', 'no_source']);
  });

  it('blocks conflicted candidates from approval routing', () => {
    const route = routeCandidate(candidate({ riskFactors: ['security', 'conflict'], conflictWith: ['k01'] }), defaultPolicy, { role: 'OWNER' });
    expect(route.action).toBe('reject');
    expect(route.canApprove).toBe(true);
  });
});
