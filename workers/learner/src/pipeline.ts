import type { LanguageModel } from 'ai';
import type { Db } from 'mongodb';
import { createEnrichmentProposalsRepo, createJobsRepo, createRetrievalGoldensRepo, type StoredEnrichmentProposal } from '@wf/db';
import { judgeTrajectory } from '@wf/agent-tools';

export interface LearnerJob {
  type: 'LEARN_TRAJECTORY';
  jobId: string;
}

export interface LearnerResult {
  jobId: string;
  proposalCount: number;
  goldenCount: number;
  proposals: StoredEnrichmentProposal[];
}

export async function runLearnerJob(job: LearnerJob, ctx: { db: Db; model: LanguageModel }): Promise<LearnerResult> {
  const jobs = createJobsRepo(ctx.db);
  const proposalsRepo = createEnrichmentProposalsRepo(ctx.db);
  const goldens = createRetrievalGoldensRepo(ctx.db);
  const steps = await jobs.getAgentSteps(job.jobId);
  const analysis = await judgeTrajectory({ model: ctx.model, jobId: job.jobId, steps });
  const proposals = await proposalsRepo.insertMany(job.jobId, analysis.proposals);
  const goldenCount = await goldens.upsertFromProposals(proposals);
  return { jobId: job.jobId, proposalCount: proposals.length, goldenCount, proposals };
}
