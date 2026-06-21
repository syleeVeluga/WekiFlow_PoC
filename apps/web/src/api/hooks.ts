import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { AgentPreviewResult, AgentStepDTO, AskCitation, AskFollowUp, AskResponse, CandidateRouteResolveAction, CandidateStatus, ConversationIngestRequest, DocumentDTO, KnowledgeCandidateListQuery, TreeNode, UpdateKnowledgeCandidateStatus } from '@wf/shared';
import * as api from './client.js';

export const queryKeys = {
  settings: ['settings'] as const,
  runtimeConfig: ['admin', 'config'] as const,
  policy: ['admin', 'policy'] as const,
  tree: ['tree'] as const,
  reviews: ['reviews'] as const,
  candidateReviewRoutes: (q: KnowledgeCandidateListQuery) => ['candidate-review-routes', q] as const,
  candidates: (q: KnowledgeCandidateListQuery) => ['candidates', q] as const,
  candidate: (id: string) => ['candidate', id] as const,
  document: (id: string) => ['document', id] as const,
  connections: (id: string) => ['connections', id] as const,
  trash: ['trash'] as const,
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

export function useCandidates(q: KnowledgeCandidateListQuery = {}) {
  return useQuery({ queryKey: queryKeys.candidates(q), queryFn: () => api.fetchCandidates(q) });
}

export function useCandidateReviewRoutes(q: KnowledgeCandidateListQuery = {}) {
  return useQuery({ queryKey: queryKeys.candidateReviewRoutes(q), queryFn: () => api.fetchCandidateReviewRoutes(q) });
}

export function useCandidate(id: string | null) {
  return useQuery({ queryKey: queryKeys.candidate(id ?? ''), queryFn: () => api.fetchCandidate(id!), enabled: id != null });
}

export function useCreateCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createCandidate,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['candidates'] }),
  });
}

export function useUpdateCandidateStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & UpdateKnowledgeCandidateStatus) => api.updateCandidateStatus(id, patch),
    onSuccess: (candidate) => {
      void qc.invalidateQueries({ queryKey: ['candidates'] });
      void qc.invalidateQueries({ queryKey: queryKeys.candidate(candidate.id) });
    },
  });
}

export function useResolveCandidateRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: CandidateRouteResolveAction }) => api.resolveCandidateRoute(id, action),
    onSuccess: (candidate) => {
      void qc.invalidateQueries({ queryKey: ['candidate-review-routes'] });
      void qc.invalidateQueries({ queryKey: ['candidates'] });
      void qc.invalidateQueries({ queryKey: queryKeys.candidate(candidate.id) });
    },
  });
}

export function useConversationIngest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConversationIngestRequest) => api.conversationIngest(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['candidates'] }),
  });
}

export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: api.fetchSettings });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.updateSettings,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.settings });
      void qc.invalidateQueries({ queryKey: queryKeys.reviews });
      void qc.invalidateQueries({ queryKey: queryKeys.tree });
      void qc.invalidateQueries({ queryKey: ['wiki'] });
    },
  });
}

export function useRuntimeConfig() {
  return useQuery({ queryKey: queryKeys.runtimeConfig, queryFn: api.fetchRuntimeConfig });
}

export function useUpdateRuntimeConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.updateRuntimeConfig,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.runtimeConfig });
      void qc.invalidateQueries({ queryKey: queryKeys.policy });
    },
  });
}

export function usePolicy() {
  return useQuery({ queryKey: queryKeys.policy, queryFn: api.fetchPolicy });
}

export function useUpdatePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.updatePolicy,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.policy });
      void qc.invalidateQueries({ queryKey: queryKeys.runtimeConfig });
    },
  });
}

export function useDocument(id: string | null): UseQueryResult<DocumentDTO> {
  return useQuery({
    queryKey: queryKeys.document(id ?? ''),
    queryFn: () => api.fetchDocument(id!),
    enabled: id != null,
  });
}

export function useConnections(id: string | null) {
  return useQuery({
    queryKey: queryKeys.connections(id ?? ''),
    queryFn: () => api.fetchConnections(id!),
    enabled: id != null,
  });
}

export function useTrash() {
  return useQuery({ queryKey: queryKeys.trash, queryFn: api.fetchTrash });
}

export function useTrashDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.trashDocument(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.tree });
      void qc.invalidateQueries({ queryKey: queryKeys.reviews });
      void qc.invalidateQueries({ queryKey: queryKeys.trash });
      void qc.invalidateQueries({ queryKey: ['wiki'] });
    },
  });
}

export function useRestoreTrash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.restoreTrash(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.tree });
      void qc.invalidateQueries({ queryKey: queryKeys.trash });
      void qc.invalidateQueries({ queryKey: ['wiki'] });
    },
  });
}

export function usePurgeTrash() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.purgeTrash(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.trash }),
  });
}

function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: queryKeys.tree });
    void qc.invalidateQueries({ queryKey: queryKeys.reviews });
    void qc.invalidateQueries({ queryKey: ['document'] });
    // The LNB Document Tree + KB read from the wiki/tree-categories family (dataQueryKeys), which is
    // materialized on approve. Invalidate it too so the new topic/page appears without a manual reload.
    void qc.invalidateQueries({ queryKey: ['wiki'] });
  };
}

export function useIngest() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: api.ingest, onSuccess: invalidate });
}

export function useIngestFile() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ file, meta }: { file: File; meta: Parameters<typeof api.ingestFile>[1] }) => api.ingestFile(file, meta),
    onSuccess: invalidate,
  });
}

export function useIngestFiles() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ files, meta }: { files: File[]; meta: Parameters<typeof api.ingestFiles>[1] }) => api.ingestFiles(files, meta),
    onSuccess: invalidate,
  });
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

export interface AskStreamState {
  question: string;
  answer: string;
  citations: AskCitation[];
  usedTrustLevels: CandidateStatus[];
  needsAttention: boolean;
  followUp: AskFollowUp | null;
  loading: boolean;
  done: boolean;
  failed: boolean;
  error: string | null;
}

const INITIAL_ASK_STATE: AskStreamState = {
  question: '',
  answer: '',
  citations: [],
  usedTrustLevels: [],
  needsAttention: false,
  followUp: null,
  loading: false,
  done: false,
  failed: false,
  error: null,
};

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

export function useAsk() {
  const abortRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<AskStreamState>(INITIAL_ASK_STATE);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL_ASK_STATE);
  }, []);

  const askQuestion = useCallback((question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ ...INITIAL_ASK_STATE, question: trimmed, loading: true });
    void api.ask(
      trimmed,
      (event, data) => {
        if (event === 'answer') {
          const payload = data as AskResponse;
          setState((prev) => ({
            ...prev,
            answer: payload.answer,
            citations: payload.citations,
            usedTrustLevels: payload.usedTrustLevels,
            needsAttention: payload.needsAttention,
            followUp: payload.followUp ?? null,
          }));
        }
        if (event === 'completed') {
          setState((prev) => ({ ...prev, loading: false, done: true, failed: false }));
        }
        if (event === 'failed') {
          const payload = data as { error?: string; followUp?: AskFollowUp };
          setState((prev) => ({
            ...prev,
            loading: false,
            done: true,
            failed: true,
            error: payload.error ?? '답변에 실패했습니다.',
            followUp: payload.followUp ?? null,
          }));
        }
      },
      controller.signal,
    ).catch((error) => {
      if (controller.signal.aborted) return;
      setState((prev) => ({
        ...prev,
        loading: false,
        done: true,
        failed: true,
        error: error instanceof Error ? error.message : '답변에 실패했습니다.',
      }));
    });
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { ...state, ask: askQuestion, reset };
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
