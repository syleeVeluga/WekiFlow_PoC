import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { KnowledgeQuery, MsResolveBody, UserRole } from '@wf/shared';
import { dataClient } from './client.js';
import { dataQueryKeys } from './queryKeys.js';

function invalidateWiki(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['wiki'] });
}

export function useKnowledgeItems(q: KnowledgeQuery) {
  return useQuery({ queryKey: dataQueryKeys.knowledge(q), queryFn: () => dataClient.listKnowledge(q) });
}

export function useKnowledgeItem(id: string | null) {
  return useQuery({ queryKey: dataQueryKeys.knowledgeItem(id ?? ''), queryFn: () => dataClient.getKnowledge(id!), enabled: id != null });
}

export function useTopics() {
  return useQuery({ queryKey: dataQueryKeys.topics, queryFn: dataClient.listTopics });
}

export function useAiTagSuggestions() {
  return useQuery({ queryKey: dataQueryKeys.aiTags, queryFn: dataClient.listAiTagSuggestions });
}

export function useReviewBoard() {
  return useQuery({ queryKey: dataQueryKeys.reviews, queryFn: dataClient.listReviews });
}

export function useMultiSource() {
  return useQuery({ queryKey: dataQueryKeys.multiSource, queryFn: dataClient.listMultiSource });
}

export function useDigest() {
  return useQuery({ queryKey: dataQueryKeys.digest, queryFn: dataClient.digest });
}

export function useActivity(limit = 5) {
  return useQuery({ queryKey: [...dataQueryKeys.activity, limit], queryFn: () => dataClient.activity(limit) });
}

export function useTreeCategories() {
  return useQuery({ queryKey: dataQueryKeys.treeCategories, queryFn: dataClient.treeCategories });
}

export function usePatchKnowledge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, contentMarkdown }: { id: string; contentMarkdown: string }) => dataClient.patchKnowledge(id, contentMarkdown),
    onSuccess: () => invalidateWiki(qc),
  });
}

export function useResolveReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, role }: { id: string; action: 'approve' | 'reject'; role: UserRole }) => dataClient.resolveReview(id, action, role),
    onSuccess: () => invalidateWiki(qc),
  });
}

export function useResolveMultiSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body, role }: { id: string; body: MsResolveBody; role: UserRole }) => dataClient.resolveMultiSource(id, body, role),
    onSuccess: () => invalidateWiki(qc),
  });
}

export function useMultiSourceActions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'split' | 'request-confirm' }) =>
      action === 'split' ? dataClient.splitMultiSource(id) : dataClient.requestConfirmMultiSource(id),
    onSuccess: () => invalidateWiki(qc),
  });
}

export function useTopicMutations() {
  const qc = useQueryClient();
  const create = useMutation({ mutationFn: dataClient.createTopic, onSuccess: () => invalidateWiki(qc) });
  const remove = useMutation({ mutationFn: dataClient.deleteTopic, onSuccess: () => invalidateWiki(qc) });
  return { create, remove };
}

export function useAiTagMutations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) => dataClient.resolveAiTagSuggestion(id, action),
    onSuccess: () => invalidateWiki(qc),
  });
}
