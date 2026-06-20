import type { KnowledgeQuery } from '@wf/shared';

export const dataQueryKeys = {
  knowledge: (q: KnowledgeQuery) => ['wiki', 'knowledge', q] as const,
  knowledgeItem: (id: string) => ['wiki', 'knowledge', id] as const,
  topics: ['wiki', 'topics'] as const,
  aiTags: ['wiki', 'ai-tags'] as const,
  reviews: ['wiki', 'reviews'] as const,
  multiSource: ['wiki', 'multi-source'] as const,
  digest: ['wiki', 'digest'] as const,
  activity: ['wiki', 'activity'] as const,
  treeCategories: ['wiki', 'tree-categories'] as const,
  knowledgeMap: ['wiki', 'knowledge-map'] as const,
};
