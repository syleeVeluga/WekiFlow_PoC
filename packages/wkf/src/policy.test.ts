import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { defaultPolicy, enforcePolicy, loadEffectivePolicy, loadPolicy, PolicyError, PolicySchema } from './policy.js';

const regulationDoc = {
  frontmatter: { type: 'REGULATION', source_tier: 'external' as const, tags: [] },
  body: '# Facts\n- Annual leave is 15 days.\n',
};

describe('policy engine', () => {
  it('loads default policy values from an absent or partial policy.yaml', async () => {
    const root = join(tmpdir(), `wkf-policy-${randomUUID()}`);
    await mkdir(root, { recursive: true });
    expect(await loadPolicy(root)).toMatchObject({
      freshness: { REGULATION: '90d', POLICY: '180d', METRIC: '30d', default: '365d' },
      sources: { auto_publish_max_tier: 'internal' },
    });

    await writeFile(join(root, 'policy.yaml'), 'citations:\n  required_for: [POLICY]\n', 'utf8');
    expect((await loadPolicy(root)).citations.required_for).toEqual(['POLICY']);
  });

  it('blocks commit when required citations are missing', () => {
    expect(() => enforcePolicy('commit', regulationDoc, defaultPolicy)).toThrow(PolicyError);
  });

  it('enforces source-tier review and type-specific approver overrides', () => {
    expect(() => enforcePolicy('ingest', regulationDoc, defaultPolicy)).toThrow('external requires review');
    expect(() => enforcePolicy('review', regulationDoc, defaultPolicy, { role: 'APPROVER' })).not.toThrow();
    expect(() => enforcePolicy('review', regulationDoc, defaultPolicy, { role: 'REVIEWER' })).toThrow('cannot approve REGULATION');
  });

  it('rejects unknown roles and prefers runtime overrides when resolving policy', async () => {
    expect(() => PolicySchema.parse({ review: { approver_roles: ['ADMIN'] } })).toThrow('Unknown role: ADMIN');
    const runtimePolicy = { ...defaultPolicy, review: { ...defaultPolicy.review, approver_roles: ['OWNER'], overrides: {} } };
    await expect(loadEffectivePolicy(runtimePolicy, process.cwd())).resolves.toMatchObject({
      review: { approver_roles: ['OWNER'] },
    });
  });
});
