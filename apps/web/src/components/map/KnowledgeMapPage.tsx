import { useMemo, useState } from 'react';
import type { KnowledgeMapEdge, KnowledgeMapNode } from '@wf/shared';
import { useKnowledgeMap } from '../../data/hooks.js';
import { useUiStore } from '../../store.js';
import { Badge } from '../common/Primitives.js';

type LayoutMode = 'graph' | 'list';

function edgePeer(edge: KnowledgeMapEdge, nodeId: string): string {
  return edge.source === nodeId ? edge.target : edge.source;
}

export function KnowledgeMapPage() {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [layout, setLayout] = useState<LayoutMode>('graph');
  const [includeTyped, setIncludeTyped] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const openDoc = useUiStore((s) => s.openDoc);
  const { data, isLoading } = useKnowledgeMap(includeTyped);

  const graph = data ?? { nodes: [], edges: [], unresolvedLinks: [], generatedAt: '' };
  const typeOptions = useMemo(() => ['all', ...new Set(graph.nodes.map((node) => node.type))], [graph.nodes]);
  const visibleNodes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return graph.nodes.filter((node) => {
      const typeOk = typeFilter === 'all' || node.type === typeFilter;
      const queryOk = !needle || `${node.title} ${node.path} ${node.tags.join(' ')}`.toLowerCase().includes(needle);
      return typeOk && queryOk;
    });
  }, [graph.nodes, query, typeFilter]);
  const selected = visibleNodes.find((node) => node.id === selectedId) ?? visibleNodes[0] ?? graph.nodes[0] ?? null;
  const shownEdges = includeTyped ? graph.edges : graph.edges.filter((edge) => edge.kind !== 'typed_relation');
  const selectedEdges = selected ? shownEdges.filter((edge) => edge.source === selected.id || edge.target === selected.id) : [];

  return (
    <section className="page map-page">
      <div className="rv-head">
        <div>
          <p className="eyebrow">지식 연결</p>
          <h1>지식 맵</h1>
        </div>
        <div className="map-metrics">
          <Badge tone="info">{visibleNodes.length}개 노드</Badge>
          <Badge>{shownEdges.length}개 연결</Badge>
        </div>
      </div>

      <div className="map-toolbar">
        <input aria-label="지식 검색" value={query} placeholder="제목, 경로, 태그 검색" onChange={(event) => setQuery(event.target.value)} />
        <select aria-label="유형 필터" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          {typeOptions.map((type) => <option value={type} key={type}>{type === 'all' ? '전체 유형' : type}</option>)}
        </select>
        <div className="seg">
          <button type="button" className={layout === 'graph' ? 'on' : ''} onClick={() => setLayout('graph')}>그래프</button>
          <button type="button" className={layout === 'list' ? 'on' : ''} onClick={() => setLayout('list')}>목록</button>
        </div>
        <label className="map-toggle">
          <input type="checkbox" checked={includeTyped} onChange={(event) => setIncludeTyped(event.target.checked)} />
          관계 인덱스
        </label>
      </div>

      {isLoading ? (
        <div className="empty">지식 맵을 불러오는 중입니다.</div>
      ) : (
        <div className="map-layout">
          <section className={`map-canvas map-${layout}`}>
            {visibleNodes.map((node) => (
              <button
                type="button"
                className={`map-node ${selected?.id === node.id ? 'on' : ''} node-${node.type.toLowerCase()}`}
                key={node.id}
                onClick={() => setSelectedId(node.id)}
              >
                <strong>{node.title}</strong>
                <span>{node.type} · {node.backlinkCount} backlinks</span>
                {node.tags.length > 0 ? <small>{node.tags.slice(0, 3).map((tag) => `#${tag}`).join(' ')}</small> : null}
              </button>
            ))}
            {visibleNodes.length === 0 ? <div className="empty">조건에 맞는 지식이 없습니다.</div> : null}
          </section>

          <aside className="map-detail">
            {selected ? (
              <>
                <div className="rv-head">
                  <div>
                    <Badge tone={selected.type === 'TAG' ? 'neutral' : 'info'}>{selected.type}</Badge>
                    <h2>{selected.title}</h2>
                  </div>
                  {selected.type !== 'TAG' ? <button type="button" onClick={() => openDoc(selected.id)}>열기</button> : null}
                </div>
                <p className="muted">{selected.path}</p>
                <div className="map-stat-row">
                  <span>{selected.linkCount} outgoing</span>
                  <span>{selected.backlinkCount} backlinks</span>
                  <span>{selected.headingCount} headings</span>
                </div>
                {selected.tags.length > 0 ? (
                  <div className="map-tags">{selected.tags.map((tag) => <span key={`${selected.id}-${tag}`}>#{tag}</span>)}</div>
                ) : null}
                <h3>연결</h3>
                <div className="map-edge-list">
                  {selectedEdges.map((edge) => {
                    const peer = graph.nodes.find((node) => node.id === edgePeer(edge, selected.id));
                    return (
                      <button type="button" key={edge.id} onClick={() => setSelectedId(peer?.id ?? null)}>
                        <span>{edge.kind === 'typed_relation' ? '관계 인덱스' : edge.kind === 'tag' ? '태그' : '링크'}</span>
                        <strong>{edge.label}</strong>
                        <small>{peer?.title ?? edgePeer(edge, selected.id)}</small>
                      </button>
                    );
                  })}
                  {selectedEdges.length === 0 ? <p className="muted">연결된 지식이 없습니다.</p> : null}
                </div>
              </>
            ) : (
              <p className="muted">노드를 선택하세요.</p>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
