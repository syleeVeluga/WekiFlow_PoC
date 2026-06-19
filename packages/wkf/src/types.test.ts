import { describe, expect, it } from 'vitest';
import { FrontmatterSchema, RECOMMENDED_TYPES } from './index.js';

describe('FrontmatterSchema', () => {
  it('requires a non-empty type', () => {
    expect(FrontmatterSchema.safeParse({}).success).toBe(false);
    expect(FrontmatterSchema.safeParse({ type: '' }).success).toBe(false);
    expect(FrontmatterSchema.parse({ type: 'REGULATION' }).type).toBe('REGULATION');
  });

  it('preserves unknown keys for OKF compatibility', () => {
    const parsed = FrontmatterSchema.parse({
      type: 'Reference',
      custom_okf_key: { nested: true },
    });

    expect(parsed.custom_okf_key).toEqual({ nested: true });
  });

  it('defaults tags to an empty array', () => {
    expect(FrontmatterSchema.parse({ type: 'POLICY' }).tags).toEqual([]);
  });

  it('keeps the recommended type vocabulary open', () => {
    expect(RECOMMENDED_TYPES).toContain('REGULATION');
    expect(FrontmatterSchema.parse({ type: 'Custom Type' }).type).toBe('Custom Type');
  });
});
