import { useState } from 'react';
import { useKnowledgeItem, usePatchKnowledge } from '../../data/hooks.js';
import { useUiStore } from '../../store.js';
import { Body } from '../kb/KbPage.js';

export function DocPage() {
  const selectedDocId = useUiStore((s) => s.selectedDocId);
  const { data: doc } = useKnowledgeItem(selectedDocId);
  const { docTab, docEditing, setDocTab, setDocEditing, openCategory, showToast } = useUiStore();
  const patch = usePatchKnowledge();
  const [draft, setDraft] = useState('');
  if (!doc) return <section className="pg stub"><h1>문서를 선택하세요</h1></section>;
  const save = () => patch.mutate({ id: doc.id, contentMarkdown: draft }, { onSuccess: () => { setDocEditing(false); showToast('저장했습니다.', 'ok'); } });
  return (
    <section className="pg doc-page">
      <div className="topbar"><div><h1>{doc.title}</h1><p>{doc.category} · {doc.department}</p></div><button className="btn" onClick={() => openCategory(doc.category)}>← 카테고리로</button></div>
      <div className="doc-toolbar"><div className="tabs">{(['edit', 'source', 'relations', 'history'] as const).map((tab) => <button className={docTab === tab ? 'on' : ''} onClick={() => setDocTab(tab)} key={tab}>{tab === 'edit' ? '편집' : tab === 'source' ? '소스' : tab === 'relations' ? '연결 관계' : '변경 기록'}</button>)}</div><button className="btn" onClick={() => showToast('챗봇 컨텍스트를 전환했습니다.', 'inf')}>챗봇 토글</button></div>
      <div className="card doc-body">
        {docTab === 'edit' ? <>{doc.sourceLabel.includes('Slack') ? <div className="learn-box">AI 학습: Slack 원천에서 감지된 지식입니다.</div> : null}{docEditing ? <><textarea value={draft || doc.contentMarkdown} onChange={(e) => setDraft(e.target.value)} /><button className="btn-primary" onClick={save}>저장</button><button className="btn" onClick={() => setDocEditing(false)}>취소</button></> : <><Body markdown={doc.contentMarkdown} /><button className="btn-primary" onClick={() => { setDraft(doc.contentMarkdown); setDocEditing(true); }}>편집하기</button></>}</> : docTab === 'source' ? <pre>{JSON.stringify({ sourceLabel: doc.sourceLabel, origin: doc.origin, lastChange: doc.lastChange }, null, 2)}</pre> : docTab === 'relations' ? <p>관련 문서: {doc.aiTags.map((tag) => `#${tag}`).join(' ')}</p> : <pre>{JSON.stringify([doc.origin, doc.lastChange], null, 2)}</pre>}
      </div>
    </section>
  );
}
