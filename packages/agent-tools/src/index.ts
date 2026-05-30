import { TripletArraySchema, type SandboxRunResult, type Triplet } from '@wf/shared';
import type { SandboxRunner } from '@wf/sandbox';

export interface MainToolContext {
  sandbox: SandboxRunner;
  docsSnapshotDir: string;
  jobId: string;
  recordStep?: (step: { tool: string; args: unknown; result?: unknown }) => void | Promise<void>;
}

export function createMainTools(ctx: MainToolContext) {
  return {
    async tool_execute_sandbox_terminal(input: {
      language?: 'bash' | 'python';
      code: string;
      timeoutMs?: number;
    }): Promise<SandboxRunResult> {
      const result = await ctx.sandbox.run({
        language: input.language ?? 'bash',
        code: input.code,
        docsSnapshotDir: ctx.docsSnapshotDir,
        timeoutMs: input.timeoutMs ?? 10_000,
      });
      await ctx.recordStep?.({
        tool: 'tool_execute_sandbox_terminal',
        args: input,
        result: { exitCode: result.exitCode, truncated: result.truncated },
      });
      return result;
    },
    async tool_search_graph() {
      await ctx.recordStep?.({ tool: 'tool_search_graph', args: {}, result: { paths: [] } });
      return { paths: [] as unknown[] };
    },
  };
}

export function extractTripletsDeterministic(markdown: string): { triplets: Triplet[] } {
  const triplets: Triplet[] = [];

  if (markdown.includes('신입사원') && markdown.includes('연차 15일')) {
    triplets.push({
      subject: '신입사원',
      predicate: '부여받는다',
      object: '연차 15일',
      subjectType: 'PERSON',
      objectType: 'REGULATION',
      strength: 0.9,
    });
  }

  if (markdown.includes('연차 사용 신청') && markdown.includes('부서장')) {
    triplets.push({
      subject: '연차 사용 신청',
      predicate: '결재권자',
      object: '부서장',
      subjectType: 'POLICY',
      objectType: 'PERSON',
      strength: 0.95,
    });
  }

  return TripletArraySchema.parse({ triplets });
}
