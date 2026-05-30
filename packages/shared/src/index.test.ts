import { describe, expect, it } from 'vitest';
import { TripletArraySchema, canApprove, normalizeEntityName } from './index.js';

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

  it('normalizes Korean entity surface forms consistently', () => {
    expect(normalizeEntityName('연차 15일')).toBe('연차15일');
  });
});
