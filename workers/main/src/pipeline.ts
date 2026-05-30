export interface MainPipelineResult {
  documentId: string;
  status: 'REVIEW';
  draftMarkdown: string;
}

export async function runMainPipelineStub(input: {
  documentId: string;
  contentMarkdown: string;
}): Promise<MainPipelineResult> {
  return {
    documentId: input.documentId,
    status: 'REVIEW',
    draftMarkdown: `${input.contentMarkdown}\n\n[stub-merged-by-main-worker]`,
  };
}
