import { describe, expect, it } from 'vitest';
import { createMainTools, extractTripletsDeterministic } from './index.js';

describe('@wf/agent-tools', () => {
  it('extracts stable schema-valid PoC triplets', () => {
    const result = extractTripletsDeterministic(`
      연차 규정 제4조 2항: 신입사원은 입사와 동시에 연차 15일을 부여받는다.
      연차 사용 신청은 부서장의 결재를 받아야 한다.
    `);

    expect(result.triplets.map((triplet) => triplet.object)).toContain('연차 15일');
    expect(result.triplets.map((triplet) => triplet.object)).toContain('부서장');
  });

  it('records tool calls for jobs.agentSteps style auditing', async () => {
    const steps: unknown[] = [];
    const tools = createMainTools({
      docsSnapshotDir: '/tmp/docs',
      jobId: 'job-1',
      sandbox: {
        async run() {
          return { stdout: 'ok', stderr: '', exitCode: 0, truncated: false };
        },
      },
      recordStep(step) {
        steps.push(step);
      },
    });

    await tools.tool_execute_sandbox_terminal({ code: 'rg annual /docs' });

    expect(steps).toHaveLength(1);
    expect(JSON.stringify(steps[0])).toContain('tool_execute_sandbox_terminal');
  });
});
