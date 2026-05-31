import { describe, expect, it } from 'vitest';
import { isObjectId } from './docId.js';

describe('isObjectId', () => {
  it('accepts a 24-char hex ObjectId (case-insensitive)', () => {
    expect(isObjectId('507f1f77bcf86cd799439011')).toBe(true);
    expect(isObjectId('AABBCCDDEEFF001122334455')).toBe(true);
  });

  it('rejects wiki slugs and other shapes', () => {
    expect(isObjectId('k01')).toBe(false);
    expect(isObjectId('preview-doc-1')).toBe(false);
    expect(isObjectId('507f1f77bcf86cd79943901')).toBe(false); // 23 chars
    expect(isObjectId('507f1f77bcf86cd7994390111')).toBe(false); // 25 chars
    expect(isObjectId('507f1f77bcf86cd79943901g')).toBe(false); // non-hex
  });

  it('treats null/undefined/empty as not a real doc', () => {
    expect(isObjectId(null)).toBe(false);
    expect(isObjectId(undefined)).toBe(false);
    expect(isObjectId('')).toBe(false);
  });
});
