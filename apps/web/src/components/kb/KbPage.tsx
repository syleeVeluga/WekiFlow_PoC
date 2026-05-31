import type { ReactNode } from 'react';
import { UNCLASSIFIED_TOPIC_NAME, createDefaultTopics, type KnowledgeFreshness, type KnowledgeItem, type Topic } from '@wf/shared';
import { useAiTagMutations, useAiTagSuggestions, useKnowledgeItems, useTopics, useTopicMutations } from '../../data/hooks.js';
import { avColor, catTint } from '../../lib/format.js';
import { useUiStore } from '../../store.js';
import { Modal } from '../common/Primitives.js';

const STATUS = [
  { key: 'all', label: '전체', color: undefined },
  { key: 'latest', label: '✓ 최신', color: 'var(--teal)' },
  { key: 'needs_update', label: '⚠ 업데이트 필요', color: 'var(--orange)' },
  { key: 'conflict', label: '● 충돌 감지', color: 'var(--error)' },
] as const;

function sdotClass(freshness: KnowledgeFreshness): string {
  return freshness === 'conflict' ? 'sd-cf' : freshness === 'needs_update' ? 'sd-upd' : 'sd-ok';
}

export function KbPage() {
  const { kb, selectedCategory, setKb, openDoc, openCategory, modal, setModal, go } = useUiStore();
  const query = { person: kb.personF, topic: kb.topicF, tag: kb.tagF, status: kb.statusF, q: kb.query, sort: kb.sort };
  const { data: items = [] } = useKnowledgeItems(query);
  const { data: allItems = [] } = useKnowledgeItems({ person: 'all', topic: 'all', tag: null, status: 'all', q: '', sort: 'uses' });
  const { data: topics = [] } = useTopics();
  const { data: suggestions = [] } = useAiTagSuggestions();

  const people = [...new Set(allItems.map((item) => item.authorName))];
  const tagCounts = new Map<string, number>();
  for (const item of allItems) for (const tag of item.aiTags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const realTopics = topics.filter((topic) => !topic.isUnclassified);
  const unclassified = topics.find((topic) => topic.isUnclassified) ?? {
    ...createDefaultTopics()[0],
    count: allItems.filter((item) => item.category === UNCLASSIFIED_TOPIC_NAME).length,
  };

  // 통합 보기: 열어둔 카테고리(selectedCategory)와 활성 주제 필터가 일치할 때만 — 사이드바 주제 클릭과 구분.
  const integrated = kb.mode === 'cat' && kb.topicF !== 'all' && selectedCategory === kb.topicF;

  return (
    <section className="wiki-shell">
      <aside className="wiki-filter">
        <div className="wf-sec">
          <div className="wf-label">담당자</div>
          <button type="button" className={`wf-row ${kb.personF === 'all' ? 'on' : ''}`} onClick={() => setKb({ personF: 'all' })}>
            <span style={{ width: 20 }} /><span className="wf-name">전체 담당자</span><span className="wf-cnt">{allItems.length}</span>
          </button>
          {people.map((person) => (
            <button type="button" key={person} className={`wf-row ${kb.personF === person ? 'on' : ''}`} onClick={() => setKb({ personF: person })}>
              <span className="wf-av" style={{ background: avColor(person) }}>{person.slice(0, 1)}</span>
              <span className="wf-name">{person}</span>
              <span className="wf-cnt">{allItems.filter((item) => item.authorName === person).length}</span>
            </button>
          ))}
        </div>
        <div className="wf-divider" />
        <div className="wf-sec">
          <div className="wf-label">주제 분류 <button type="button" className="wf-manage" onClick={() => setModal({ catManager: true })}>관리</button></div>
          <button type="button" className={`wf-row ${kb.topicF === 'all' ? 'on' : ''}`} onClick={() => setKb({ topicF: 'all', tagF: null })}>
            <span className="wf-dot" style={{ background: 'var(--stone)' }} /><span className="wf-name">전체 분류</span><span className="wf-cnt">{allItems.length}</span>
          </button>
          {realTopics.map((topic) => (
            <button type="button" key={topic.id} className={`wf-row ${kb.topicF === topic.name ? 'on' : ''}`} onClick={() => setKb({ topicF: topic.name, tagF: null })}>
              <span className="wf-dot" style={{ background: catTint(topic.name) }} />
              <span className="wf-name">{topic.name}</span>
              {topic.source === 'user' ? <span className="wf-lock" title="직접 추가">✎</span> : null}
              <span className="wf-cnt">{topic.count}</span>
            </button>
          ))}
          <button type="button" className={`wf-row ${kb.topicF === UNCLASSIFIED_TOPIC_NAME ? 'on' : ''}`} onClick={() => setKb({ topicF: UNCLASSIFIED_TOPIC_NAME, tagF: null })}>
              <span className="wf-dot" style={{ background: 'var(--muted)' }} /><span className="wf-name" style={{ color: 'var(--stone)' }}>미분류</span><span className="wf-cnt">{unclassified.count}</span>
          </button>
        </div>
        <div className="wf-divider" />
        <div className="wf-sec">
          <div className="wf-label">AI 자동 분류 태그</div>
          {tags.map(([tag, count]) => (
            <button type="button" key={tag} className={`wf-tag-row ${kb.tagF === tag ? 'on' : ''}`} onClick={() => setKb({ tagF: kb.tagF === tag ? null : tag, topicF: 'all' })}>
              <span className="wf-tag-hash">#</span><span className="wf-tag-name">{tag}</span><span className="wf-cnt">{count}</span>
            </button>
          ))}
          <div className="wf-note">AI 자동 분류는 태그로 구분됩니다</div>
        </div>
        <div className="wf-divider" />
        <div className="wf-sec">
          <div className="wf-label">상태</div>
          {STATUS.map((status) => (
            <button type="button" key={status.key} className={`wf-row ${kb.statusF === status.key ? 'on' : ''}`} onClick={() => setKb({ statusF: status.key })}>
              <span className="wf-name" style={status.color ? { color: status.color } : undefined}>{status.label}</span>
            </button>
          ))}
        </div>
      </aside>

      <div className="wiki-main">
        <div className="wiki-topbar">
          <div className="wiki-search"><span>⌕</span><input value={kb.query} placeholder="지식 검색..." onChange={(e) => setKb({ query: e.target.value })} /></div>
          <span className="wiki-count">{allItems.length}개 중 {items.length}개</span>
          <div className="wiki-tb-right">
            <div className="view-seg">
              <button type="button" className={`view-seg-btn ${kb.mode === 'grid' ? 'on' : ''}`} onClick={() => setKb({ mode: 'grid' })}>그리드</button>
              <button type="button" className={`view-seg-btn ${kb.mode === 'cat' ? 'on' : ''}`} onClick={() => setKb({ mode: 'cat', topicF: 'all', tagF: null })}>카테고리별</button>
            </div>
            <select className="wiki-sort" value={kb.sort} onChange={(e) => setKb({ sort: e.target.value as never })}>
              <option value="uses">참조 많은순</option>
              <option value="recent">최근 수정순</option>
              <option value="alpha">가나다순</option>
            </select>
            <button type="button" className="kb-add" onClick={() => go('add')}>+ 직접 추가</button>
          </div>
        </div>
        <div className="wiki-content">
          {integrated ? (
            <IntegratedView
              items={items}
              category={selectedCategory}
              userTopic={realTopics.some((topic) => topic.name === selectedCategory && topic.source === 'user')}
              onBack={() => setKb({ mode: 'grid', topicF: 'all' })}
              onOpen={openDoc}
            />
          ) : (
            <>
              {suggestions.length > 0 ? (
                <button type="button" className="ai-banner" onClick={() => setModal({ aiTags: true })}>
                  <span className="ai-banner-ic">🤖</span>
                  <span className="ai-banner-text">AI 자동 분류 제안 검토 대기</span>
                  <span className="ai-banner-cnt">{suggestions.length}</span>
                  <span className="ai-banner-arrow">→</span>
                </button>
              ) : null}
              {kb.mode === 'grid' ? (
                <div className="wiki-grid">{items.length ? items.map((item) => <KnowledgeCard key={item.id} item={item} onOpen={() => openDoc(item.id, item.category)} />) : <EmptyKB />}</div>
              ) : (
                <GroupedView items={items} topics={realTopics} onOpenCategory={openCategory} onOpenDoc={openDoc} />
              )}
            </>
          )}
        </div>
      </div>

      {modal.aiTags ? <AiTagReviewModal /> : null}
      {modal.catManager ? <CategoryManagerModal /> : null}
    </section>
  );
}

function KnowledgeCard({ item, onOpen }: { item: KnowledgeItem; onOpen: () => void }) {
  const col = catTint(item.category);
  const extra = item.aiTags.length - 3;
  return (
    <button className="kbc" type="button" onClick={onOpen}>
      <div className="kbc-head"><div className="kbc-title">{item.title}</div><div className={`kbc-sdot ${sdotClass(item.freshness)}`} /></div>
      <div className="kbc-desc">{item.summary}</div>
      {item.aiTags.length ? (
        <div className="kbc-tags">
          {item.aiTags.slice(0, 3).map((tag) => <span className="kbc-tag" key={tag}>{tag}</span>)}
          {extra > 0 ? <span className="kbc-tag-more">+{extra}</span> : null}
        </div>
      ) : null}
      <div className="kbc-foot">
        <span className="kbc-cat" style={{ background: `${col}1a`, color: col }}>{item.category}</span>
        {item.modCount > 0 ? <span className="kbc-mod">수정 {item.modCount}</span> : null}
        <span className="kbc-author"><span className="kbc-av" style={{ background: avColor(item.authorName) }}>{item.authorName.slice(0, 1)}</span>{item.authorName}</span>
        <span className="kbc-ref">참조 {item.usageCount}</span>
      </div>
    </button>
  );
}

function GroupedView({
  items,
  topics,
  onOpenCategory,
  onOpenDoc,
}: {
  items: KnowledgeItem[];
  topics: Topic[];
  onOpenCategory: (name: string) => void;
  onOpenDoc: (id: string, category?: string) => void;
}) {
  const groups = topics.map((topic) => ({ topic, list: items.filter((item) => item.category === topic.name) })).filter((group) => group.list.length > 0);
  const uncList = items.filter((item) => item.category === UNCLASSIFIED_TOPIC_NAME);
  if (!groups.length && !uncList.length) return <div className="wiki-grid"><EmptyKB /></div>;
  return (
    <>
      {groups.map(({ topic, list }) => (
        <div className="cat-group" key={topic.id}>
          <div className="cat-group-head">
            <span className="cat-group-dot" style={{ background: catTint(topic.name) }} />
            <span className="cat-group-name" onClick={() => onOpenCategory(topic.name)}>{topic.name}</span>
            <span className="cat-group-cnt">{list.length}건</span>
            {topic.source === 'user' ? <span className="badge badge-info">직접 추가</span> : null}
            <button type="button" className="btn-link" style={{ marginLeft: 'auto' }} onClick={() => onOpenCategory(topic.name)}>통합 보기 →</button>
          </div>
          <div className="wiki-grid">{list.map((item) => <KnowledgeCard key={item.id} item={item} onOpen={() => onOpenDoc(item.id, item.category)} />)}</div>
        </div>
      ))}
      {uncList.length ? (
        <div className="cat-group">
          <div className="cat-group-head">
            <span className="cat-group-dot" style={{ background: 'var(--muted)' }} />
            <span className="cat-group-name" style={{ color: 'var(--slate)', cursor: 'default' }}>미분류</span>
            <span className="cat-group-cnt">{uncList.length}건</span>
            <span className="cat-group-warn">⚠ 최초 자동 수집된 지식 · 주제 배정 필요</span>
          </div>
          <div className="wiki-grid">{uncList.map((item) => <KnowledgeCard key={item.id} item={item} onOpen={() => onOpenDoc(item.id, item.category)} />)}</div>
        </div>
      ) : null}
    </>
  );
}

function IntegratedView({
  items,
  category,
  userTopic,
  onBack,
  onOpen,
}: {
  items: KnowledgeItem[];
  category: string;
  userTopic: boolean;
  onBack: () => void;
  onOpen: (id: string, category?: string) => void;
}) {
  const col = catTint(category);
  return (
    <div className="wiki-intg">
      <div className="intg-head">
        <div className="intg-title-row">
          <div className="intg-title"><span className="intg-title-dot" style={{ background: col }} />{category} <span className="intg-title-sub">(통합 보기)</span></div>
          <button type="button" className="intg-back" onClick={onBack}>← 위키 홈으로</button>
        </div>
        <div className="intg-desc">카테고리 내의 하위 문서 {items.length}건을 일괄 스크롤하며 확인할 수 있습니다.{userTopic ? ' · 직접 추가한 주제입니다.' : ''}</div>
      </div>
      <div className="intg-divider" />
      {items.map((doc, index) => (
        <article className="intg-doc" key={doc.id}>
          <div className="intg-doc-top">
            <span className="intg-doc-num">문서 #{index + 1}</span>
            <button type="button" className="intg-doc-open" onClick={() => onOpen(doc.id, doc.category)}>단일 페이지 열기 ↗</button>
          </div>
          <div className="intg-doc-title" onClick={() => onOpen(doc.id, doc.category)}>{doc.title}</div>
          <div className="intg-doc-meta">
            <span className="intg-doc-meta-item">👤 작성자: {doc.authorName}</span>
            <span className="intg-doc-meta-item">🕐 갱신일: {doc.updatedAtLabel}</span>
            <span className="intg-doc-meta-item">📍 {doc.sourceLabel}</span>
            <span className="intg-doc-meta-item">📊 참조 {doc.usageCount}회</span>
          </div>
          <IntgBody markdown={doc.contentMarkdown} />
        </article>
      ))}
    </div>
  );
}

// 신뢰된 시드 본문을 ■ 헤더 / • · - · ①·N. 목록 / 문단으로 렌더(목업 fmtBody 이식). # 제목 줄은 별도 표기되어 생략.
function IntgBody({ markdown }: { markdown: string }) {
  const nodes: ReactNode[] = [];
  let list: string[] = [];
  let key = 0;
  const flush = () => {
    if (list.length) {
      const current = list;
      nodes.push(<ul key={`u${key++}`}>{current.map((text, i) => <li key={i}>{text}</li>)}</ul>);
      list = [];
    }
  };
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith('#')) continue;
    if (line.startsWith('■')) { flush(); nodes.push(<h4 key={`h${key++}`}>{line.replace(/^■\s*/, '')}</h4>); }
    else if (line.startsWith('•') || line.startsWith('-')) list.push(line.replace(/^[•-]\s*/, ''));
    else if (/^[①②③④⑤⑥⑦⑧⑨⑩]/.test(line) || /^\d+\./.test(line)) list.push(line);
    else { flush(); nodes.push(<p key={`p${key++}`}>{line}</p>); }
  }
  flush();
  return <div className="intg-doc-body">{nodes}</div>;
}

function EmptyKB() {
  return <div className="kb-empty"><div className="kb-empty-ic">📭</div><div className="kb-empty-msg">결과가 없습니다</div></div>;
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
