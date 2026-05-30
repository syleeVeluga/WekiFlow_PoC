import { extractTripletsDeterministic } from '@wf/agent-tools';

export async function runGraphPipelineStub(input: { documentId: string; markdown: string }) {
  return {
    documentId: input.documentId,
    status: 'GRAPH_INDEXED' as const,
    ...extractTripletsDeterministic(input.markdown),
  };
}
