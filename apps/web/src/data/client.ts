import type {
  ActivityEntry,
  AiTagSuggestion,
  DailyDigest,
  JobRef,
  KnowledgeItem,
  KnowledgeQuery,
  MsResolveBody,
  MultiSourceGroup,
  ReviewItem,
  Topic,
  TreeCategory,
} from '@wf/shared';
import { request } from '../api/client.js';

function qs(query: Record<string, string | number | null | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

export const dataClient = {
  listKnowledge(q: KnowledgeQuery): Promise<KnowledgeItem[]> {
    return request(`/knowledge?${qs(q)}`);
  },
  getKnowledge(id: string): Promise<KnowledgeItem> {
    return request(`/knowledge/${id}`);
  },
  patchKnowledge(id: string, contentMarkdown: string): Promise<KnowledgeItem> {
    return request(`/knowledge/${id}`, { method: 'PATCH', body: JSON.stringify({ contentMarkdown }) });
  },
  setKnowledgeCategory(id: string, category: string): Promise<KnowledgeItem> {
    return request(`/knowledge/${id}/category`, { method: 'PATCH', body: JSON.stringify({ category }) });
  },
  listTopics(): Promise<Topic[]> {
    return request('/topics');
  },
  createTopic(name: string): Promise<Topic> {
    return request('/topics', { method: 'POST', body: JSON.stringify({ name }) });
  },
  deleteTopic(id: string): Promise<{ ok: boolean; reassigned: number }> {
    return request(`/topics/${id}`, { method: 'DELETE' });
  },
  declassifyCategory(name: string): Promise<{ ok: boolean; reassigned: number }> {
    return request('/topics/declassify', { method: 'POST', body: JSON.stringify({ name }) });
  },
  listAiTagSuggestions(): Promise<AiTagSuggestion[]> {
    return request('/ai-tag-suggestions');
  },
  resolveAiTagSuggestion(id: string, action: 'approve' | 'reject'): Promise<{ ok: boolean }> {
    return request(`/ai-tag-suggestions/${id}/${action}`, { method: 'POST' });
  },
  listReviews(): Promise<ReviewItem[]> {
    return request('/reviews/rich');
  },
  resolveReview(id: string, action: 'approve' | 'reject'): Promise<{ ok: true; job: JobRef }> {
    return request(`/reviews/${id}/${action}`, { method: 'POST' });
  },
  listMultiSource(): Promise<MultiSourceGroup[]> {
    return request('/multi-source');
  },
  resolveMultiSource(id: string, body: MsResolveBody): Promise<{ ok: true; job: JobRef }> {
    return request(`/multi-source/${id}/resolve`, { method: 'POST', body: JSON.stringify(body) });
  },
  splitMultiSource(id: string): Promise<{ ok: boolean }> {
    return request(`/multi-source/${id}/split`, { method: 'POST' });
  },
  requestConfirmMultiSource(id: string): Promise<{ ok: boolean }> {
    return request(`/multi-source/${id}/request-confirm`, { method: 'POST' });
  },
  digest(): Promise<DailyDigest> {
    return request('/home/digest');
  },
  activity(limit = 5): Promise<ActivityEntry[]> {
    return request(`/activity?limit=${limit}`);
  },
  treeCategories(): Promise<TreeCategory[]> {
    return request('/tree/categories');
  },
};
