import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { parseCitations } from './sections.js';
import type { WkfDoc } from './types.js';

const DEFAULT_FRESHNESS = { REGULATION: '90d', POLICY: '180d', METRIC: '30d', default: '365d' };
const DEFAULT_SOURCES = {
  tiers: ['official', 'internal', 'external', 'unverified'],
  auto_publish_max_tier: 'internal',
  allowed_hosts: [],
};
const DEFAULT_ENRICHMENT = { web_max_pages: 50, agent_step_limit: 12 };
const DEFAULT_CITATIONS = { required_for: ['REGULATION', 'POLICY'], require_fact_verification: true };
const DEFAULT_REVIEW = { approver_roles: ['ADMIN', 'REVIEWER'], overrides: { REGULATION: ['ADMIN'] } };
const DEFAULT_CONFORMANCE = { reject_on_missing_type: true, block_commit_on_validate_fail: true };

export const PolicySchema = z.object({
  wkf_version: z.string().default('0.1'),
  freshness: z
    .object({
      REGULATION: z.string().default('90d'),
      POLICY: z.string().default('180d'),
      METRIC: z.string().default('30d'),
      default: z.string().default('365d'),
    })
    .catchall(z.string())
    .default(DEFAULT_FRESHNESS),
  sources: z
    .object({
      tiers: z.array(z.string()).default(['official', 'internal', 'external', 'unverified']),
      auto_publish_max_tier: z.string().default('internal'),
      allowed_hosts: z.array(z.string()).default([]),
    })
    .default(DEFAULT_SOURCES),
  enrichment: z
    .object({
      web_max_pages: z.number().int().positive().default(50),
      agent_step_limit: z.number().int().positive().default(12),
    })
    .default(DEFAULT_ENRICHMENT),
  citations: z
    .object({
      required_for: z.array(z.string()).default(['REGULATION', 'POLICY']),
      require_fact_verification: z.boolean().default(true),
    })
    .default(DEFAULT_CITATIONS),
  review: z
    .object({
      approver_roles: z.array(z.string()).default(['ADMIN', 'REVIEWER']),
      overrides: z.record(z.string(), z.array(z.string())).default({ REGULATION: ['ADMIN'] }),
    })
    .default(DEFAULT_REVIEW),
  conformance: z
    .object({
      reject_on_missing_type: z.boolean().default(true),
      block_commit_on_validate_fail: z.boolean().default(true),
    })
    .default(DEFAULT_CONFORMANCE),
});

export type Policy = z.infer<typeof PolicySchema>;
export type PolicyAction = 'commit' | 'ingest' | 'curation' | 'review';

export interface PolicyContext {
  role?: string;
  sourceTier?: string;
}

export class PolicyError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Policy violation: ${issues.join('; ')}`);
    this.name = 'PolicyError';
  }
}

export const defaultPolicy: Policy = PolicySchema.parse({});

function parsePolicyYaml(raw: string, path: string): Policy {
  const parsed = parseDocument(raw, { strict: true });
  if (parsed.errors.length > 0) throw new Error(`Invalid ${path}: ${parsed.errors[0]!.message}`);
  return PolicySchema.parse(parsed.toJSON() ?? {});
}

export async function loadPolicy(bundlePath: string): Promise<Policy> {
  const path = join(bundlePath, 'policy.yaml');
  const raw = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  return raw.trim() ? parsePolicyYaml(raw, 'policy.yaml') : defaultPolicy;
}

function roleMatches(actual: string | undefined, allowed: string[]): boolean {
  if (!actual) return false;
  const normalized = actual.toUpperCase();
  const aliases = new Set<string>([normalized]);
  if (normalized === 'OWNER' || normalized === 'APPROVER') aliases.add('ADMIN');
  if (normalized === 'REVIEWER') aliases.add('REVIEWER');
  return allowed.some((role) => aliases.has(role.toUpperCase()));
}

function tierRank(policy: Policy, tier: string): number {
  const index = policy.sources.tiers.indexOf(tier);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

export function enforcePolicy(action: PolicyAction, doc: WkfDoc, policy: Policy = defaultPolicy, context: PolicyContext = {}): void {
  const issues: string[] = [];
  const type = doc.frontmatter.type;

  if (policy.conformance.reject_on_missing_type && !type?.trim()) {
    issues.push('type is required');
  }

  if ((action === 'commit' || action === 'curation') && policy.citations.required_for.includes(type) && parseCitations(doc.body).length === 0) {
    issues.push(`${type} requires # Citations`);
  }

  const sourceTier = context.sourceTier ?? doc.frontmatter.source_tier;
  if (action === 'ingest' && sourceTier && tierRank(policy, sourceTier) > tierRank(policy, policy.sources.auto_publish_max_tier)) {
    issues.push(`${sourceTier} requires review`);
  }

  if (action === 'review') {
    const allowed = policy.review.overrides[type] ?? policy.review.approver_roles;
    if (!roleMatches(context.role, allowed)) {
      issues.push(`${context.role ?? 'anonymous'} cannot approve ${type}`);
    }
  }

  if (issues.length > 0) throw new PolicyError(issues);
}
