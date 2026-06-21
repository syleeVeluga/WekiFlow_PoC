import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { canEdit, type KnowledgeItem } from '@wf/shared';
import { useConnections, useDocument, useOrganizeDocument } from '../../api/hooks.js';
import { useKnowledgeItem, usePatchKnowledge, useSetKnowledgeCategory, useTopicMutations, useTopics } from '../../data/hooks.js';
import { useAuthStore } from '../../auth/store.js';
import { useUiStore } from '../../store.js';
import { BlockNotePane } from '../blocknote/BlockNotePane.js';
import { Badge, Modal } from '../common/Primitives.js';
import { TopicChipGrid } from '../common/TopicChipGrid.js';

const MonacoDiffPane = lazy(async () => {
  const module = await import('../monaco/MonacoDiffPane.js');
  return { default: module.MonacoDiffPane };
});

const DOC_TABS = ['edit', 'source', 'relations', 'history'] as const;

const TAB_LABELS = {
  edit: '편집',
  source: '소스',
  relations: '연결 관계',
  history: '변경 기록',
} satisfies Record<(typeof DOC_TABS)[number], string>;

function documentStatusView(status: string): { label: string; tone: 'neutral' | 'ok' | 'warn' | 'error' | 'info'; note?: string } {
  if (status === 'PUBLISHED' || status === 'GRAPH_INDEXED') return { label: '공식 지식', tone: 'ok' };
  if (status === 'REVIEW') return { label: '확인 필요', tone: 'warn', note: 'AI가 정리한 초안이지만, 현재 설정 또는 정책상 확인 후 반영됩니다.' };
  if (status === 'PROCESSING') return { label: 'AI 처리 중', tone: 'info', note: '업로드된 원본을 AI가 읽고 지식화 가능 여부를 판단하는 중입니다.' };
  if (status === 'FAILED') return { label: '처리 실패', tone: 'error', note: 'AI 처리 중 오류가 발생했습니다. 다시 분석하거나 원본을 확인해야 합니다.' };
  if (status === 'DRAFT') return { label: '지식화 안 됨', tone: 'warn', note: '업로드된 원본은 보관되어 있지만 아직 홈, 조직 지식, 지식 맵에 쓰이는 공식 지식은 아닙니다.' };
  return { label: status, tone: 'neutral' };
}

function strengthDots(strength: number): string {
  const filled = Math.min(3, Math.max(1, Math.round(strength * 3)));
  return '●●●'.slice(0, filled) + '○○○'.slice(0, 3 - filled);
}

/**
 * "연결 관계" tab: the facts this document contributed to the knowledge graph plus other
 * documents that mention the same entities — a source-discovery view instead of a node-link graph.
 */
function RelationsView({ docId }: { docId: string }) {
  const { data, isLoading } = useConnections(docId);
  const openDoc = useUiStore((s) => s.openDoc);

  if (isLoading) return <p className="muted">연결 관계를 불러오는 중…</p>;
  const facts = data?.facts ?? [];
  const related = data?.relatedDocs ?? [];
  if (facts.length === 0 && related.length === 0) {
    return <p className="muted">아직 추출된 연결 관계가 없습니다. 그래프 분석이 완료되면 표시됩니다.</p>;
  }

  return (
    <div className="rel-view">
      {facts.length ? (
        <section className="rel-block">
          <div className="dp-sec-label">이 문서가 다루는 핵심 사실</div>
          <ul className="rel-facts">
            {facts.map((fact, index) => (
              <li className="rel-fact" key={`${fact.subject}-${fact.predicate}-${fact.object}-${index}`}>
                <span className="rel-subj">{fact.subject}</span>
                <span className="rel-pred">{fact.predicate}</span>
                <span className="rel-obj">{fact.object}</span>
                <span className="rel-strength" title={`신뢰도 ${Math.round(fact.strength * 100)}%`}>{strengthDots(fact.strength)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {related.length ? (
        <section className="rel-block">
          <div className="dp-sec-label">이 내용이 함께 언급된 문서</div>
          <ul className="rel-docs">
            {related.map((rel) => (
              <li key={rel.documentId}>
                <button type="button" className="rel-doc-row" onClick={() => openDoc(rel.documentId)}>
                  <span className="rel-doc-title">{rel.title}</span>
                  <span className="rel-doc-shared">{rel.sharedEntities.map((entity) => <em className="rel-chip" key={entity}>{entity}</em>)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function DocPage() {
  const selectedDocId = useUiStore((s) => s.selectedDocId);
  // The tree opens materialized wiki items keyed by the document ObjectId, so always resolve the
  // knowledge item first (getKnowledge matches by wiki.id regardless of id shape). Fall back to the
  // read-only real-document view only when no wiki item exists (e.g. a doc still in review).
  const { data: doc } = useKnowledgeItem(selectedDocId);
  const { data: realDoc } = useDocument(selectedDocId);
  const { docTab, setDocTab, openCategory, showToast, selectedCategory } = useUiStore();
  const role = useAuthStore((s) => s.user?.role ?? 'VIEWER');
  const editable = canEdit(role);
  const patch = usePatchKnowledge();
  const organize = useOrganizeDocument();
  const [draft, setDraft] = useState<string | null>(null);
  // Which revision the 변경 기록 tab has expanded into a diff (null = list only). Reset on doc/tab change.
  const [openRevision, setOpenRevision] = useState<string | null>(null);
  // Whether the 주제 변경 modal is open (editable wiki pages only).
  const [catOpen, setCatOpen] = useState(false);

  useEffect(() => {
    setDraft(doc?.contentMarkdown ?? null);
  }, [doc?.id, doc?.contentMarkdown]);

  useEffect(() => {
    setOpenRevision(null);
    setCatOpen(false);
  }, [selectedDocId, docTab]);

  const historyMeta = useMemo(() => {
    if (!doc) return [];
    return [doc.origin, doc.lastChange].filter((item): item is NonNullable<typeof item> => item != null);
  }, [doc]);

  // --- Editable wiki page (the common case: any page opened from the tree / KB) ---
  if (doc) {
    const currentMarkdown = draft ?? doc.contentMarkdown;
    const changed = currentMarkdown !== doc.contentMarkdown;
    const save = () => patch.mutate({ id: doc.id, contentMarkdown: currentMarkdown }, { onSuccess: () => showToast('저장했습니다.', 'ok') });
    const saveBtn = (
      <div className="doc-actions">
        <button className="btn-primary" onClick={save} disabled={!changed || patch.isPending}>저장</button>
      </div>
    );
    const knowledgeStateBadge = doc.aiTags.includes('AI 정리됨') ? <Badge tone="info">지식화 완료</Badge> : <Badge tone="ok">공식 지식</Badge>;

    return (
      <section className="pg doc-page">
        <div className="topbar"><div><h1>{doc.title}</h1><p className="doc-meta-line">{knowledgeStateBadge}{editable ? <button type="button" className="doc-cat-edit" title="주제 변경" onClick={() => setCatOpen(true)}>{doc.category} <span className="doc-cat-edit-ic">✎</span></button> : doc.category} · {doc.department}</p></div><button className="btn" onClick={() => openCategory(doc.category)}>← 카테고리로</button></div>
        {catOpen ? <CategoryPickerModal item={doc} onClose={() => setCatOpen(false)} /> : null}
        <div className="doc-toolbar"><div className="tabs">{DOC_TABS.map((tab) => <button className={docTab === tab ? 'on' : ''} onClick={() => setDocTab(tab)} key={tab}>{TAB_LABELS[tab]}</button>)}</div><button className="btn" onClick={() => showToast('챗봇 컨텍스트를 전환했습니다.', 'inf')}>챗봇 토글</button></div>
        <div className="card doc-body">
          {docTab === 'edit' ? (
            <>
              {doc.sourceLabel.includes('Slack') ? <div className="learn-box">AI 학습: Slack 원천에서 감지된 지식입니다.</div> : null}
              <BlockNotePane markdown={currentMarkdown} editable={editable} onMarkdownChange={setDraft} />
              {editable ? saveBtn : null}
            </>
          ) : docTab === 'source' ? (
            editable ? (
              <>
                <textarea className="markdown-source-edit" value={currentMarkdown} spellCheck={false} onChange={(event) => setDraft(event.target.value)} />
                {saveBtn}
              </>
            ) : (
              <pre className="markdown-source"><code>{currentMarkdown}</code></pre>
            )
          ) : docTab === 'relations' ? (
            <RelationsView docId={doc.id} />
          ) : (
            <>
              <div className="history-meta">{historyMeta.map((item) => <span key={`${item.label}-${item.at}`}>{item.label} · {item.at} · {item.by} · {item.source}</span>)}</div>
              <Suspense fallback={<div className="panel">Diff loading</div>}>
                <MonacoDiffPane original={doc.contentMarkdown} modified={currentMarkdown} />
              </Suspense>
            </>
          )}
        </div>
      </section>
    );
  }

  // --- Read-only fallback for real documents without a materialized wiki item (e.g. in review) ---
  if (realDoc) {
    const hasDraft = realDoc.draftMarkdown != null && realDoc.draftMarkdown !== realDoc.contentMarkdown;
    const statusView = documentStatusView(realDoc.status);
    const canOrganizeSource = editable && realDoc.status === 'DRAFT';
    const organizeSource = () => {
      organize.mutate(
        { id: realDoc.id },
        {
          onSuccess: () => showToast('지식화 완료 후 공식 지식에 반영했습니다.', 'ok'),
          onError: (error) => showToast(error instanceof Error ? error.message : '지식화에 실패했습니다.', 'warn'),
        },
      );
    };
    return (
      <section className="pg doc-page">
        <div className="topbar">
          <div>
            <h1>{realDoc.title}</h1>
            <p><Badge tone={statusView.tone}>{statusView.label}</Badge> version {realDoc.version}</p>
          </div>
          <div className="doc-top-actions">
            {canOrganizeSource ? <button className="btn-primary" onClick={organizeSource} disabled={organize.isPending}>AI로 지식화</button> : null}
            {selectedCategory ? <button className="btn" onClick={() => openCategory(selectedCategory)}>← 카테고리로</button> : null}
          </div>
        </div>
        {statusView.note ? <div className="source-state-note">{statusView.note}</div> : null}
        <div className="doc-toolbar"><div className="tabs">{DOC_TABS.map((tab) => <button className={docTab === tab ? 'on' : ''} onClick={() => setDocTab(tab)} key={tab}>{TAB_LABELS[tab]}</button>)}</div><button className="btn" onClick={() => showToast('챗봇 컨텍스트를 전환했습니다.', 'inf')}>챗봇 토글</button></div>
        <div className="card doc-body">
          {docTab === 'edit' ? (
            <BlockNotePane markdown={realDoc.draftMarkdown ?? realDoc.contentMarkdown} editable={false} />
          ) : docTab === 'source' ? (
            <pre className="markdown-source"><code>{realDoc.contentMarkdown}</code></pre>
          ) : docTab === 'relations' ? (
            <RelationsView docId={realDoc.id} />
          ) : (
            <div className="doc-history">
              <div className="dp-sec-label">이 문서의 변경 기록</div>
              {hasDraft ? (
                <button type="button" className={`rev-item ${openRevision === 'draft' ? 'on' : ''}`} onClick={() => setOpenRevision(openRevision === 'draft' ? null : 'draft')}>
                  <span className="rev-dot rev-draft" />
                  <span className="rev-body"><span className="rev-action">검토 중 초안 (v{realDoc.version + 1} 예정)</span><span className="rev-meta">현재 발행본과 비교하려면 클릭</span></span>
                </button>
              ) : null}
              <div className="rev-item rev-static">
                <span className="rev-dot rev-current" />
                <span className="rev-body"><span className="rev-action">현재 발행본 (v{realDoc.version})</span><span className="rev-meta">{realDoc.updatedAt}{realDoc.approvedBy ? ` · 승인: ${realDoc.approvedBy}` : ''}</span></span>
              </div>
              {hasDraft ? null : <p className="rev-empty">검토 중인 변경 사항이 없습니다.</p>}
              {openRevision === 'draft' && hasDraft ? (
                <Suspense fallback={<div className="panel">Diff loading</div>}>
                  <MonacoDiffPane original={realDoc.contentMarkdown} modified={realDoc.draftMarkdown!} />
                </Suspense>
              ) : null}
            </div>
          )}
        </div>
      </section>
    );
  }

  return <section className="pg stub"><h1>문서를 선택하세요</h1></section>;
}

/** 주제 변경 모달: 기존 주제 선택 · 미분류로 되돌리기 · 새 주제 인라인 생성. */
function CategoryPickerModal({ item, onClose }: { item: KnowledgeItem; onClose: () => void }) {
  const { data: topics = [] } = useTopics();
  const topicMutations = useTopicMutations();
  const setCategory = useSetKnowledgeCategory();
  const showToast = useUiStore((s) => s.showToast);

  const assign = (category: string) => {
    if (setCategory.isPending) return;
    setCategory.mutate(
      { id: item.id, category },
      {
        onSuccess: () => {
          showToast('주제를 변경했습니다.', 'ok');
          onClose();
        },
      },
    );
  };

  const createAndAssign = (name: string) => {
    topicMutations.create.mutate(name, { onSuccess: (topic) => assign(topic.name) });
  };

  return (
    <Modal title="주제 변경" onClose={onClose}>
      <p className="add-help">이 페이지를 배정할 주제를 선택하거나 새 주제를 만듭니다.</p>
      <TopicChipGrid
        topics={topics}
        selected={item.category}
        onSelect={assign}
        onCreate={createAndAssign}
        createPending={topicMutations.create.isPending}
        disabled={setCategory.isPending}
      />
    </Modal>
  );
}
