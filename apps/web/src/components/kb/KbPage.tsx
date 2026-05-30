import type { KnowledgeItem } from '@wf/shared';
import { useAiTagMutations, useAiTagSuggestions, useKnowledgeItems, useTopics, useTopicMutations } from '../../data/hooks.js';
import { catTint, freshnessLabel } from '../../lib/format.js';
import { useUiStore } from '../../store.js';
import { Avatar, Badge, Modal } from '../common/Primitives.js';

export function KbPage() {
  const { kb, selectedCategory, setKb, openDoc, openCategory, modal, setModal } = useUiStore();
  const query = { person: kb.personF, topic: kb.topicF, tag: kb.tagF, status: kb.statusF, q: kb.query, sort: kb.sort };
  const { data: items = [] } = useKnowledgeItems(query);
  const { data: allItems = [] } = useKnowledgeItems({ person: 'all', topic: 'all', tag: null, status: 'all', q: '', sort: 'uses' });
  const { data: topics = [] } = useTopics();
  const { data: suggestions = [] } = useAiTagSuggestions();
  const people = [...new Set(allItems.map((item) => item.authorName))];
  const tags = [...new Set(allItems.flatMap((item) => item.aiTags))].slice(0, 12);
  const grouped = topics.map((topic) => ({ topic, items: items.filter((item) => item.category === topic.name) })).filter((g) => g.items.length > 0);

  if (selectedCategory && kb.mode === 'cat' && kb.topicF !== 'all') {
    return <CategoryView items={items} category={selectedCategory} onBack={() => setKb({ mode: 'grid', topicF: 'all' })} />;
  }

  return (
    <section className="pg wiki-shell">
      <aside className="kb-filter card">
        <h3>담당자</h3><div className="filter-list"><button className={`filter-row ${kb.personF === 'all' ? 'on' : ''}`} onClick={() => setKb({ personF: 'all' })}>전체</button>{people.map((person) => <button key={person} className={`filter-row ${kb.personF === person ? 'on' : ''}`} onClick={() => setKb({ personF: person })}><span><Avatar name={person} /> {person}</span><b>{allItems.filter((i) => i.authorName === person).length}</b></button>)}</div>
        <h3>주제 분류 <button className="btn-ghost" onClick={() => setModal({ catManager: true })}>관리</button></h3><div className="filter-list"><button className={`filter-row ${kb.topicF === 'all' ? 'on' : ''}`} onClick={() => setKb({ topicF: 'all', tagF: null })}>전체</button>{topics.map((topic) => <button key={topic.id} className={`filter-row ${kb.topicF === topic.name ? 'on' : ''}`} onClick={() => setKb({ topicF: topic.name, tagF: null })}><span><i className="cat-dot" style={{ background: catTint(topic.name) }} /> {topic.name}{topic.source === 'user' ? ' ✎' : ''}</span><b>{topic.count}</b></button>)}</div>
        <h3>AI 자동 분류 태그</h3><div className="tag-list">{tags.map((tag) => <button key={tag} className={`badge ${kb.tagF === tag ? 'badge-info' : 'badge-neutral'}`} onClick={() => setKb({ tagF: kb.tagF === tag ? null : tag, topicF: 'all' })}>#{tag}</button>)}</div>
        <h3>상태</h3>{(['all', 'latest', 'needs_update', 'conflict'] as const).map((status) => <button key={status} className={`filter-row ${kb.statusF === status ? 'on' : ''}`} onClick={() => setKb({ statusF: status })}>{status === 'all' ? '전체' : freshnessLabel(status)}</button>)}
      </aside>
      <main className="kb-main">
        <div className="topbar"><div><h1>조직 지식</h1><p>{allItems.length}개 중 {items.length}개</p></div><button className="btn-primary" onClick={() => setModal({ aiTags: true })}>AI 태그 검토 {suggestions.length}</button></div>
        <div className="kb-toolbar"><input value={kb.query} placeholder="검색" onChange={(e) => setKb({ query: e.target.value })} /><select value={kb.sort} onChange={(e) => setKb({ sort: e.target.value as never })}><option value="uses">참조 많은순</option><option value="recent">최근 수정순</option><option value="alpha">가나다순</option></select><button className="btn" onClick={() => setKb({ mode: kb.mode === 'grid' ? 'cat' : 'grid' })}>{kb.mode === 'grid' ? '카테고리별' : '그리드'}</button><button className="btn" onClick={() => alert('준비 중')}>+ 직접 추가</button></div>
        {suggestions.length > 0 ? <div className="card ai-banner">AI가 {suggestions.length}개의 태그를 제안했습니다. <button className="btn-primary" onClick={() => setModal({ aiTags: true })}>검토</button></div> : null}
        {kb.mode === 'grid' ? <div className="grid kb-grid">{items.map((item) => <KnowledgeCard key={item.id} item={item} onOpen={() => openDoc(item.id, item.category)} />)}</div> : grouped.map(({ topic, items: groupItems }) => <section className="cat-section" key={topic.id}><div className="cat-head"><h2><i className="cat-dot" style={{ background: catTint(topic.name) }} /> {topic.name} ({groupItems.length})</h2><button className="btn" onClick={() => openCategory(topic.name)}>통합 보기 →</button></div><div className="grid kb-grid">{groupItems.map((item) => <KnowledgeCard key={item.id} item={item} onOpen={() => openDoc(item.id, item.category)} />)}</div></section>)}
      </main>
      {modal.aiTags ? <AiTagReviewModal /> : null}
      {modal.catManager ? <CategoryManagerModal /> : null}
    </section>
  );
}

function KnowledgeCard({ item, onOpen }: { item: KnowledgeItem; onOpen: () => void }) {
  return (
    <button className="card kb-card" type="button" onClick={onOpen}>
      <Badge tone={item.freshness === 'latest' ? 'ok' : item.freshness === 'needs_update' ? 'warn' : 'error'}>{freshnessLabel(item.freshness)}</Badge>
      <h3>{item.title}</h3><p>{item.summary}</p>
      <div className="tag-list">{item.aiTags.slice(0, 3).map((tag) => <span className="badge badge-neutral" key={tag}>#{tag}</span>)}</div>
      <div className="kb-meta"><span className="cat-chip" style={{ background: catTint(item.category) }}>{item.category}</span><span>수정 {item.modCount}</span><span><Avatar name={item.authorName} /> {item.authorName}</span><span>참조 {item.usageCount}</span></div>
    </button>
  );
}

function CategoryView({ items, category, onBack }: { items: KnowledgeItem[]; category: string; onBack: () => void }) {
  const openDoc = useUiStore((s) => s.openDoc);
  return <section className="pg category-view"><button className="btn" onClick={onBack}>← 위키 홈으로</button><h1>{category} 통합 보기</h1>{items.map((item) => <article className="card" key={item.id}><h2>{item.title}</h2><Body markdown={item.contentMarkdown} /><button className="btn-primary" onClick={() => openDoc(item.id, item.category)}>단일 페이지 열기 ↗</button></article>)}</section>;
}

export function Body({ markdown }: { markdown: string }) {
  return <div>{markdown.split(/\r?\n/).filter(Boolean).map((line) => <div className={`body-line ${line.startsWith('#') ? 'heading' : ''}`} key={line}>{line.replace(/^#+\s*/, '')}</div>)}</div>;
}

function AiTagReviewModal() {
  const { data = [] } = useAiTagSuggestions();
  const mutate = useAiTagMutations();
  const setModal = useUiStore((s) => s.setModal);
  return <Modal title="AI 태그 제안" onClose={() => setModal({ aiTags: false })}>{data.map((s) => <div className="filter-row" key={s.id}><span>{s.itemTitle} → #{s.tag}<small> {s.reason}</small></span><span><button className="btn-primary" onClick={() => mutate.mutate({ id: s.id, action: 'approve' })}>승인</button><button className="btn" onClick={() => mutate.mutate({ id: s.id, action: 'reject' })}>반려</button></span></div>)}</Modal>;
}

function CategoryManagerModal() {
  const { data = [] } = useTopics();
  const mutations = useTopicMutations();
  const setModal = useUiStore((s) => s.setModal);
  return <Modal title="주제 관리" onClose={() => setModal({ catManager: false })}><button className="btn-primary" onClick={() => mutations.create.mutate(`사용자 주제 ${data.length + 1}`)}>주제 추가</button>{data.map((topic) => <div className="filter-row" key={topic.id}><span>{topic.name} · {topic.source}</span><button className="btn" disabled={topic.source === 'system'} onClick={() => mutations.remove.mutate(topic.id)}>삭제</button></div>)}</Modal>;
}
