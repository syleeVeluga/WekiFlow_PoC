import { describe, expect, it } from 'vitest';
import {
  DocumentStatusSchema,
  CANDIDATE_STATUS_LABEL,
  CANDIDATE_TO_DOC_STATUS,
  ConversationIngestRequestSchema,
  ConversationIngestResultSchema,
  CreateKnowledgeCandidateSchema,
  CandidateContractSchema,
  CandidateProvenanceSchema,
  DOC_STATUS_TO_CANDIDATE,
  KnowledgeCandidateSchema,
  RISK_FACTOR_LABEL,
  JobQueueSchema,
  JobTypeSchema,
  KnowledgeFreshnessSchema,
  TagClassificationSchema,
  TripletArraySchema,
  RuntimeConfigPatchSchema,
  RuntimeConfigSchema,
  canAccessDevPanel,
  canApprove,
  canAutoPublish,
  canManageUsers,
  canReview,
  canTransitionCandidate,
  chunkMarkdown,
  createDefaultRuntimeConfig,
  createSeedKnowledgeItems,
  defaultCandidateStatusForProvenance,
  mergeRuntimeConfig,
  mergeRuntimeConfigPatch,
  needsReview,
  normalizeEntityName,
  riskFactors,
} from './index.js';

describe('@wf/shared', () => {
  it('validates triplet arrays', () => {
    const parsed = TripletArraySchema.parse({
      triplets: [
        {
          subject: '신입사원',
          predicate: '부여받는다',
          object: '연차 15일',
          subjectType: 'PERSON',
          objectType: 'REGULATION',
          strength: 0.9,
        },
      ],
    });

    expect(parsed.triplets).toHaveLength(1);
  });

  it('requires two to four classified tags', () => {
    expect(TagClassificationSchema.safeParse({ tags: ['one'] }).success).toBe(false);
    expect(TagClassificationSchema.parse({ tags: ['one', 'two'] }).tags).toEqual(['one', 'two']);
    expect(TagClassificationSchema.parse({ tags: ['one', 'two', 'three', 'four'] }).tags).toEqual([
      'one',
      'two',
      'three',
      'four',
    ]);
    expect(TagClassificationSchema.safeParse({ tags: ['one', 'two', 'three', 'four', 'five'] }).success).toBe(false);
  });

  it('separates 검토(review) from 승인(approve): reviewers cannot give final approval', () => {
    // 최종 승인은 승인(APPROVER) 이상만.
    expect(canApprove('OWNER')).toBe(true);
    expect(canApprove('APPROVER')).toBe(true);
    expect(canApprove('REVIEWER')).toBe(false);
    expect(canApprove('EDITOR')).toBe(false);
    expect(canApprove('VIEWER')).toBe(false);
    // 검토·반려는 검토(REVIEWER) 이상.
    expect(canReview('REVIEWER')).toBe(true);
    expect(canReview('EDITOR')).toBe(false);
    // 사용자 관리는 승인 + 소유자.
    expect(canManageUsers('APPROVER')).toBe(true);
    expect(canManageUsers('REVIEWER')).toBe(false);
  });

  it('keeps dev panel access separate from role rank', () => {
    expect(canAccessDevPanel({ isSuperAdmin: true })).toBe(true);
    expect(canAccessDevPanel({ isSuperAdmin: false })).toBe(false);
    expect(canAccessDevPanel({})).toBe(false);
  });

  it('merges runtime config overrides and treats null patch values as default restore', () => {
    const defaults = createDefaultRuntimeConfig({
      AGENT_MODEL: 'gpt-default',
      EMBEDDING_MODEL: 'embed-default',
      TRIPLET_GOOGLE_MODEL: 'google-default',
      TRIPLET_ANTHROPIC_MODEL: 'anthropic-default',
      TRIPLET_OPENAI_FALLBACK_MODEL: 'openai-default',
    });
    const overrides = RuntimeConfigSchema.parse({
      prompts: { main: 'custom main' },
      agentParams: { vectorK: 12 },
      models: { agentModel: 'gpt-custom' },
    });

    expect(mergeRuntimeConfig(defaults, overrides)).toMatchObject({
      prompts: { main: 'custom main', merge: defaults.prompts.merge },
      agentParams: { vectorK: 12, mainStepLimit: 12 },
      models: { agentModel: 'gpt-custom', embeddingModel: 'embed-default' },
    });

    const restored = mergeRuntimeConfigPatch(overrides, RuntimeConfigPatchSchema.parse({
      prompts: { main: null },
      agentParams: { vectorK: null, graphMaxDepth: 3 },
      models: { agentModel: null },
    }));
    expect(restored).toMatchObject({
      prompts: {},
      agentParams: { graphMaxDepth: 3 },
      models: {},
      policy: null,
    });
  });

  it('keeps wiki freshness separate from document workflow status', () => {
    expect(KnowledgeFreshnessSchema.safeParse('latest').success).toBe(true);
    expect(DocumentStatusSchema.safeParse('latest').success).toBe(false);
    expect(createSeedKnowledgeItems()).toHaveLength(88);
  });

  it('defines candidate status labels and document status projections', () => {
    expect(CANDIDATE_STATUS_LABEL).toMatchObject({
      AI_ORGANIZED: 'AI 정리됨',
      SOURCE_VERIFIED: '출처 확인됨',
      NEEDS_CHECK: '확인 필요',
      NEEDS_APPROVAL: '승인 필요',
      PUBLISHED: '공식 지식',
      CONFLICTED: '충돌 있음',
    });
    expect(CANDIDATE_TO_DOC_STATUS).toMatchObject({
      AI_ORGANIZED: 'DRAFT',
      SOURCE_VERIFIED: 'REVIEW',
      NEEDS_CHECK: 'REVIEW',
      NEEDS_APPROVAL: 'REVIEW',
      PUBLISHED: 'PUBLISHED',
      CONFLICTED: 'REVIEW',
    });
    expect(DOC_STATUS_TO_CANDIDATE.GRAPH_INDEXED).toBe('PUBLISHED');
    expect(DOC_STATUS_TO_CANDIDATE.FAILED).toBe('NEEDS_CHECK');
  });

  it('marks every declared risk factor as needing review', () => {
    for (const riskFactor of riskFactors) {
      expect(needsReview({ riskFactors: [riskFactor] })).toBe(true);
    }
    expect(needsReview({ riskFactors: ['policy', 'security'] })).toBe(true);
    expect(needsReview({ riskFactors: [] })).toBe(false);
  });

  it('allows auto-publish only for low-risk non-conversation candidates', () => {
    const provenance = CandidateProvenanceSchema.parse({ kind: 'file', ref: 'upload://handbook.md' });

    expect(canAutoPublish({ status: 'AI_ORGANIZED', riskFactors: [], provenance })).toBe(true);
    expect(canAutoPublish({ status: 'SOURCE_VERIFIED', riskFactors: [], provenance })).toBe(true);
    expect(canAutoPublish({ status: 'NEEDS_CHECK', riskFactors: [], provenance })).toBe(false);
    expect(canAutoPublish({ status: 'AI_ORGANIZED', riskFactors: ['pricing'], provenance })).toBe(false);
    expect(
      canAutoPublish({
        status: 'SOURCE_VERIFIED',
        riskFactors: [],
        provenance: CandidateProvenanceSchema.parse({ kind: 'conversation', ref: 'chat://1' }),
      }),
    ).toBe(false);
  });

  it('defaults conversation provenance to needsSource and NEEDS_CHECK', () => {
    const provenance = CandidateProvenanceSchema.parse({
      kind: 'conversation',
      ref: 'meeting://2026-06-20',
      conversationQuote: '다음 분기부터 승인 절차를 바꿉니다.',
      speaker: '이지수',
    });

    expect(provenance).toMatchObject({
      createdFromConversation: true,
      needsSource: true,
    });
    expect(defaultCandidateStatusForProvenance(provenance)).toBe('NEEDS_CHECK');
    const manualProvenance = CandidateProvenanceSchema.parse({ kind: 'manual', ref: 'manual://1' });
    expect(defaultCandidateStatusForProvenance(manualProvenance)).toBe('AI_ORGANIZED');
  });

  it('validates candidate contracts and transition rules', () => {
    expect(
      CandidateContractSchema.parse({
        status: 'SOURCE_VERIFIED',
        provenance: { kind: 'url', ref: 'https://example.test/policy' },
      }),
    ).toMatchObject({ riskFactors: [] });

    expect(canTransitionCandidate('AI_ORGANIZED', 'SOURCE_VERIFIED')).toBe(true);
    expect(canTransitionCandidate('NEEDS_APPROVAL', 'PUBLISHED')).toBe(true);
    expect(canTransitionCandidate('PUBLISHED', 'AI_ORGANIZED')).toBe(false);
    expect(canTransitionCandidate('CONFLICTED', 'PUBLISHED')).toBe(false);
  });

  it('validates first-class knowledge candidate DTOs', () => {
    const create = CreateKnowledgeCandidateSchema.parse({
      title: '승인 정책 후보',
      provenance: { kind: 'conversation', ref: 'chat://1' },
      riskFactors: ['official_answer'],
    });
    expect(create.summary).toBe('');
    expect(create.provenance).toMatchObject({ needsSource: true });
    expect(RISK_FACTOR_LABEL.official_answer).toBe('공식 답변');

    expect(
      KnowledgeCandidateSchema.parse({
        id: 'candidate-1',
        title: create.title,
        status: 'NEEDS_CHECK',
        riskFactors: create.riskFactors,
        provenance: create.provenance,
        createdAt: '2026-06-20T00:00:00.000Z',
        updatedAt: '2026-06-20T00:00:00.000Z',
      }),
    ).toMatchObject({
      bodyMarkdown: '',
      conflictWith: [],
      summary: '',
    });
  });

  it('normalizes Korean entity surface forms consistently', () => {
    expect(normalizeEntityName('연차 15일')).toBe('연차15일');
  });

  it('chunks markdown into heading-scoped sections with heading paths', () => {
    const chunks = chunkMarkdown(
      '# 휴가 규정\n제4조 2항: 신입사원은 연차 15일을 부여받는다.\n\n## 제5조\n반차는 4시간이다.',
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.headingPath).toEqual(['휴가 규정']);
    expect(chunks[0]!.text).toContain('연차 15일');
    expect(chunks[1]!.headingPath).toEqual(['휴가 규정', '제5조']);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1]);
  });

  it('windows oversized sections with overlap under the token cap', () => {
    const body = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunkMarkdown(`# H\n${body}`, { maxTokens: 10, overlap: 2 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.tokens <= 10)).toBe(true);
    expect(chunks.every((c) => c.headingPath[0] === 'H')).toBe(true);
  });

  it('validates conversation ingest contracts', () => {
    expect(ConversationIngestRequestSchema.parse({ transcript: 'A: Decision made.' })).toMatchObject({
      source: 'manual',
      transcript: 'A: Decision made.',
    });
    expect(() => ConversationIngestRequestSchema.parse({ source: 'manual' })).toThrow();
    expect(JobQueueSchema.parse('conversation')).toBe('conversation');
    expect(JobTypeSchema.parse('INGEST_CONVERSATION')).toBe('INGEST_CONVERSATION');
    expect(
      ConversationIngestResultSchema.parse({
        jobId: 'job-1',
        type: 'INGEST_CONVERSATION',
        candidates: [
          {
            id: 'candidate-1',
            title: 'Conversation decision',
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
            status: 'NEEDS_CHECK',
            riskFactors: ['no_source'],
            provenance: { kind: 'conversation', ref: 'conversation://manual', speaker: 'A' },
          },
        ],
        createdAt: '2026-06-20T00:00:00.000Z',
      }),
    ).toMatchObject({ type: 'INGEST_CONVERSATION' });
  });
});
