import { useEffect, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { AgentPreviewResult, AgentStepDTO, DocumentDTO, TreeNode } from '@wf/shared';
import * as api from './client.js';

export const queryKeys = {
  tree: ['tree'] as const,
  reviews: ['reviews'] as const,
  document: (id: string) => ['document', id] as const,
  agentPreviews: ['agent-previews'] as const,
  agentPreview: (id: string) => ['agent-preview', id] as const,
};

export function useTree(): UseQueryResult<TreeNode[]> {
  return useQuery({ queryKey: queryKeys.tree, queryFn: api.fetchTree });
}

/** Published documents, derived from the tree (🔷 조직 지식). */
export function usePublished(): UseQueryResult<TreeNode[]> {
  return useQuery({
    queryKey: queryKeys.tree,
    queryFn: api.fetchTree,
    select: (nodes) => nodes.filter((n) => n.status === 'PUBLISHED' || n.status === 'GRAPH_INDEXED'),
  });
}

export function useReviews(): UseQueryResult<DocumentDTO[]> {
  return useQuery({ queryKey: queryKeys.reviews, queryFn: api.fetchReviews });
}

export function useDocument(id: string | null): UseQueryResult<DocumentDTO> {
  return useQuery({
    queryKey: queryKeys.document(id ?? ''),
    queryFn: () => api.fetchDocument(id!),
    enabled: id != null,
  });
}

function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: queryKeys.tree });
    void qc.invalidateQueries({ queryKey: queryKeys.reviews });
    void qc.invalidateQueries({ queryKey: ['document'] });
  };
}

export function useIngest() {
  return useMutation({ mutationFn: api.ingest });
}

export function useApprove() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => api.approve(id),
    onSuccess: invalidate,
  });
}

export function useReject() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: string) => api.reject(id),
    onSuccess: invalidate,
  });
}

export function useAgentPreviewMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.agentPreviewMessage,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.agentPreviews });
      void qc.invalidateQueries({ queryKey: queryKeys.tree });
      void qc.invalidateQueries({ queryKey: queryKeys.reviews });
    },
  });
}

export function useAgentPreviewUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, title, commit }: { file: File; title?: string; commit?: boolean }) => api.agentPreviewUpload(file, title, commit),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.agentPreviews });
      void qc.invalidateQueries({ queryKey: queryKeys.tree });
      void qc.invalidateQueries({ queryKey: queryKeys.reviews });
    },
  });
}

export function useAgentPreviews() {
  return useQuery({ queryKey: queryKeys.agentPreviews, queryFn: api.listAgentPreviews });
}

export function useAgentPreview(jobId: string | null) {
  return useQuery({
    queryKey: queryKeys.agentPreview(jobId ?? ''),
    queryFn: () => api.fetchAgentPreview(jobId!),
    enabled: jobId != null,
  });
}

export interface JobStreamState {
  progress: number;
  done: boolean;
  failed: boolean;
}

export interface AgentRunStreamState {
  steps: AgentStepDTO[];
  progress: number;
  result: AgentPreviewResult | null;
  done: boolean;
  failed: boolean;
  error: string | null;
}

const INITIAL_STREAM_STATE: AgentRunStreamState = {
  steps: [],
  progress: 0,
  result: null,
  done: false,
  failed: false,
  error: null,
};

export function useAgentRunStream(jobId: string | null): AgentRunStreamState {
  const qc = useQueryClient();
  const [state, setState] = useState<AgentRunStreamState>(INITIAL_STREAM_STATE);
  const [trackedJobId, setTrackedJobId] = useState<string | null>(jobId);

  // Reset synchronously when the selected job changes, so we never return the previous job's
  // steps/result/done for the render that happens before the EventSource effect runs.
  if (jobId !== trackedJobId) {
    setTrackedJobId(jobId);
    setState(jobId ? { ...INITIAL_STREAM_STATE, progress: 8 } : INITIAL_STREAM_STATE);
  }

  useEffect(() => {
    if (!jobId) return;
    const source = new EventSource(api.agentPreviewStreamUrl(jobId));

    source.addEventListener('step', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { index: number; step: AgentStepDTO };
      setState((prev) => {
        const steps = [...prev.steps];
        steps[data.index] = data.step;
        const compact = steps.filter((step): step is AgentStepDTO => step != null);
        return {
          ...prev,
          steps: compact,
          progress: Math.min(95, 12 + compact.length * 8),
        };
      });
    });

    source.addEventListener('completed', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { result?: AgentPreviewResult };
      setState((prev) => ({ ...prev, result: data.result ?? null, progress: 100, done: true, failed: false }));
      void qc.invalidateQueries({ queryKey: queryKeys.agentPreviews });
      void qc.invalidateQueries({ queryKey: queryKeys.agentPreview(jobId) });
      void qc.invalidateQueries({ queryKey: queryKeys.tree });
      void qc.invalidateQueries({ queryKey: queryKeys.reviews });
      source.close();
    });

    source.addEventListener('failed', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { error?: string };
      setState((prev) => ({ ...prev, done: true, failed: true, error: data.error ?? 'Preview failed' }));
      void qc.invalidateQueries({ queryKey: queryKeys.agentPreviews });
      void qc.invalidateQueries({ queryKey: queryKeys.agentPreview(jobId) });
      source.close();
    });

    return () => source.close();
  }, [jobId, qc]);

  return state;
}

/**
 * Subscribe to job progress via SSE. Invalidates queries when the job settles
 * so the new REVIEW document surfaces without a manual refresh.
 */
export function useJobStream(jobId: string | null): JobStreamState {
  const invalidate = useInvalidateAll();
  const [state, setState] = useState<JobStreamState>({ progress: 0, done: false, failed: false });

  useEffect(() => {
    if (!jobId) {
      setState({ progress: 0, done: false, failed: false });
      return;
    }
    const source = new EventSource(`/api/jobs/${jobId}/stream`);

    source.addEventListener('progress', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { progress: number };
      setState((prev) => ({ ...prev, progress: Number(data.progress) || prev.progress }));
    });
    source.addEventListener('completed', () => {
      setState({ progress: 100, done: true, failed: false });
      invalidate();
      source.close();
    });
    source.addEventListener('failed', () => {
      setState((prev) => ({ ...prev, done: true, failed: true }));
      invalidate();
      source.close();
    });

    return () => source.close();
    // invalidate is stable enough for this demo; jobId drives the subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  return state;
}
