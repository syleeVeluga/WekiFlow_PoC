import { describe, expect, it } from 'vitest';
import {
  DocumentStatusSchema,
  KnowledgeFreshnessSchema,
  TripletArraySchema,
  canApprove,
  chunkMarkdown,
  createSeedKnowledgeItems,
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

  it('keeps approval limited to reviewer roles', () => {
    expect(canApprove('ADMIN')).toBe(true);
    expect(canApprove('REVIEWER')).toBe(true);
    expect(canApprove('EDITOR')).toBe(false);
    expect(canApprove('VIEWER')).toBe(false);
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
