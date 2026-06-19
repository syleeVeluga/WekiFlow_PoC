import type { Queue } from 'bullmq';
import { loadPolicy, scanStale, type Policy, type StaleConcept } from '@wekiflow/wkf';

export const CURATION_SCAN_JOB_ID = 'curation-scan';
export const DEFAULT_CURATION_CRON = '0 3 * * *';
export const DEFAULT_SCAN_LIMIT = 100;

export interface CurationConceptJob {
  type: 'CURATE_CONCEPT';
  concept: StaleConcept;
}

export interface CurationScanResult {
  queued: number;
  stale: StaleConcept[];
}

export async function registerCurationSchedule(
  queue: Pick<Queue, 'add'>,
  cron = DEFAULT_CURATION_CRON,
): Promise<void> {
  await queue.add('SCAN_STALE', { type: 'SCAN_STALE' }, { jobId: CURATION_SCAN_JOB_ID, repeat: { pattern: cron } });
}

export async function runCurationScan(
  queue: Pick<Queue, 'add'>,
  bundlePath: string,
  options: { policy?: Policy; limit?: number; now?: Date } = {},
): Promise<CurationScanResult> {
  const policy = options.policy ?? (await loadPolicy(bundlePath));
  const stale = await scanStale(bundlePath, policy, {
    limit: options.limit ?? DEFAULT_SCAN_LIMIT,
    ...(options.now ? { now: options.now } : {}),
  });
  for (const concept of stale) {
    await queue.add('CURATE_CONCEPT', { type: 'CURATE_CONCEPT', concept } satisfies CurationConceptJob, {
      jobId: `curate:${concept.slug}`,
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }
  return { queued: stale.length, stale };
}

export async function runCurationPlaceholder(job: CurationConceptJob): Promise<{ slug: string; status: 'queued' }> {
  return { slug: job.concept.slug, status: 'queued' };
}
