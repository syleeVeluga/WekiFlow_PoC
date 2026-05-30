import { describe, expect, it } from 'vitest';
import { runMainPipelineStub } from './pipeline.js';

describe('runMainPipelineStub', () => {
  it('appends the stub merge marker and transitions to REVIEW', async () => {
    const result = await runMainPipelineStub({
      documentId: 'doc-1',
      contentMarkdown: '# 원본',
    });

    expect(result.documentId).toBe('doc-1');
    expect(result.status).toBe('REVIEW');
    expect(result.draftMarkdown).toBe('# 원본\n\n[stub-merged-by-main-worker]');
  });
});
