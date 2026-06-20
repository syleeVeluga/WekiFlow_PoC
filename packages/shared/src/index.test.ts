import { describe, expect, it } from 'vitest';
import {
  DocumentStatusSchema,
  KnowledgeFreshnessSchema,
  TagClassificationSchema,
  TripletArraySchema,
  RuntimeConfigPatchSchema,
  RuntimeConfigSchema,
  canAccessDevPanel,
  canApprove,
  canManageUsers,
  canReview,
  chunkMarkdown,
  createDefaultRuntimeConfig,
  createSeedKnowledgeItems,
  mergeRuntimeConfig,
  mergeRuntimeConfigPatch,
  normalizeEntityName,
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
});
