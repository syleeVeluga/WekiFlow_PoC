import { useEffect, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { DocumentDTO, TreeNode } from '@wf/shared';
import * as api from './client.js';

export const queryKeys = {
  tree: ['tree'] as const,
  reviews: ['reviews'] as const,
  document: (id: string) => ['document', id] as const,
};

export function useTree(): UseQueryResult<TreeNode[]> {
  return useQuery({ queryKey: queryKeys.tree, queryFn: api.fetchTree });
}

/** Published documents, derived from the tree (🔷 조직 지식). */
export function usePublished(): UseQueryResult<TreeNode[]> {
  return useQuery({
    queryKey: queryKeys.tree,
    queryFn: api.fetchTree,
    select: (nodes) => nodes.filter((n) => n.status === 'PUBLISHED'),
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

export interface JobStreamState {
  progress: number;
  done: boolean;
  failed: boolean;
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
