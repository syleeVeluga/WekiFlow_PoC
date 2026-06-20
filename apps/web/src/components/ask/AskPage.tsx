import { useMemo, useState, type FormEvent } from 'react';
import type { AskCitation } from '@wf/shared';
import { useAsk } from '../../api/hooks.js';
import { useKnowledgeMap } from '../../data/hooks.js';
import { useUiStore } from '../../store.js';
import { Badge } from '../common/Primitives.js';
import { TrustLabel } from '../common/TrustLabel.js';

function citationTarget(citation: AskCitation): string | null {
  if (citation.documentId) return citation.documentId;
  if (citation.sourceType === 'knowledge') return citation.id.replace(/^knowledge:/, '') || null;
  return null;
}

export function AskPage() {
  const [question, setQuestion] = useState('');
  const ask = useAsk();
  const openDoc = useUiStore((s) => s.openDoc);
  const { data: map } = useKnowledgeMap(false);
  const citationIds = useMemo(() => new Set(ask.citations.map(citationTarget).filter((id): id is string => Boolean(id))), [ask.citations]);
  const relatedNodes = useMemo(() => {
    if (!map || citationIds.size === 0) return [];
    const byId = new Map(map.nodes.map((node) => [node.id, node]));
    const related = new Map<string, { id: string; title: string; label: string }>();
    for (const edge of map.edges) {
      const sourceHit = citationIds.has(edge.source);
      const targetHit = citationIds.has(edge.target);
      if (sourceHit === targetHit) continue;
      const peerId = sourceHit ? edge.target : edge.source;
      const peer = byId.get(peerId);
      if (peer && peer.type !== 'TAG') related.set(peer.id, { id: peer.id, title: peer.title, label: edge.label });
    }
    return [...related.values()].slice(0, 5);
  }, [citationIds, map]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    ask.ask(question);
  };

  return (
    <section className="page ask-page">
      <div className="rv-head">
        <div>
          <p className="eyebrow">출처 확인</p>
          <h1>지식에 질문하기</h1>
        </div>
        <div className="ask-trust-strip">
          {ask.usedTrustLevels.map((status) => <TrustLabel status={status} key={status} />)}
        </div>
      </div>

      <form className="ask-form" onSubmit={submit}>
        <textarea
          aria-label="질문"
          value={question}
          placeholder="조직 지식에 물어보세요"
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button type="submit" disabled={ask.loading || !question.trim()}>{ask.loading ? '답변 중' : '질문'}</button>
      </form>

      {ask.needsAttention ? (
        <div className="ask-warning">
          <Badge tone="warn">확인 필요</Badge>
          <span>일부 근거가 아직 공식 지식으로 확정되지 않았습니다.</span>
        </div>
      ) : null}

      <section className="ask-answer">
        {ask.answer ? <p>{ask.answer}</p> : <div className="empty">{ask.loading ? '답변을 생성하는 중입니다.' : '질문하면 답변과 출처가 여기에 표시됩니다.'}</div>}
        {ask.failed ? <p className="ask-error">{ask.error}</p> : null}
        {ask.followUp ? (
          <div className="ask-follow-up">
            <Badge tone="info">부족한 지식</Badge>
            <span>{ask.followUp.reason}</span>
          </div>
        ) : null}
      </section>

      <div className="ask-supporting">
        <section>
          <div className="rv-head">
            <h2>출처</h2>
            <Badge>{ask.citations.length}개</Badge>
          </div>
          <div className="ask-citations">
            {ask.citations.map((citation) => (
              <button
                type="button"
                className="ask-citation"
                key={citation.id}
                onClick={() => {
                  const target = citationTarget(citation);
                  if (target) openDoc(target);
                }}
              >
                <div className="rv-head">
                  <strong>{citation.title}</strong>
                  <TrustLabel status={citation.trustStatus} />
                </div>
                <p>{citation.snippet}</p>
                <small>{citation.path}</small>
              </button>
            ))}
            {ask.citations.length === 0 ? <div className="empty">표시할 출처가 없습니다.</div> : null}
          </div>
        </section>

        <section>
          <div className="rv-head">
            <h2>관련 지식</h2>
            <Badge>{relatedNodes.length}개</Badge>
          </div>
          <div className="ask-related">
            {relatedNodes.map((node) => (
              <button type="button" key={node.id} onClick={() => openDoc(node.id)}>
                <strong>{node.title}</strong>
                <small>{node.label}</small>
              </button>
            ))}
            {relatedNodes.length === 0 ? <div className="empty">관련 지식이 없습니다.</div> : null}
          </div>
        </section>
      </div>
    </section>
  );
}
