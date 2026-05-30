import { useEffect, useMemo, useState } from 'react';
import type { MultiSourceGroup, ReviewItem } from '@wf/shared';
import { useMultiSource, useMultiSourceActions, useResolveMultiSource, useResolveReview, useReviewBoard } from '../../data/hooks.js';
import { useUiStore } from '../../store.js';
import { Avatar, Badge, Certainty, PriBadge } from '../common/Primitives.js';

const tabs = [
  ['all', '전체'],
  ['p0', 'P0'],
  ['p1', 'P1'],
  ['p2', 'P2'],
  ['ms', 'Multi-source'],
] as const;

function matchesTab(item: ReviewItem | MultiSourceGroup, tab: string, isMulti = false) {
  if (tab === 'all') return true;
  if (tab === 'ms') return isMulti;
  return item.priority.toLowerCase() === tab;
}

function ReviewCard({ item }: { item: ReviewItem }) {
  const { review, role, setReviewDetail, markReviewDone, showToast } = useUiStore();
  const resolve = useResolveReview();
  const done = review.rvDone[item.id] || item.resolved;

  const act = (action: 'approve' | 'reject') => {
    resolve.mutate(
      { id: item.id, action, role },
      {
        onSuccess: () => {
          markReviewDone(item.id);
          showToast(action === 'approve' ? '검토 항목을 반영했습니다.' : '검토 항목을 제외했습니다.', 'ok');
        },
        onError: (error) => showToast(error instanceof Error ? error.message : '처리에 실패했습니다.', 'warn'),
      },
    );
  };

  return (
    <article className={`card ri-card ${done ? 'gone' : ''}`} onClick={() => setReviewDetail(item.id)}>
      <div>
        <div className="row">
          <PriBadge value={item.priority} />
          <Certainty value={item.certainty} />
          <Badge tone="info">{item.changeType}</Badge>
        </div>
        <h3>{item.topicTitle}</h3>
        <p className="muted">{item.reason}</p>
        <p>{item.newValue}</p>
        <div className="row sm">
          <Avatar name={item.source.author} />
          <span>{item.source.channel}</span>
          <span>{item.source.time}</span>
        </div>
      </div>
      <div className="ri-actions" onClick={(event) => event.stopPropagation()}>
        <button type="button" title="승인" onClick={() => act('approve')}>
          ✓
        </button>
        <button type="button" title="반려" onClick={() => act('reject')}>
          ×
        </button>
      </div>
    </article>
  );
}

function MultiSourceCard({ group }: { group: MultiSourceGroup }) {
  const { role, showToast, openDoc } = useUiStore();
  const resolve = useResolveMultiSource();
  const aux = useMultiSourceActions();
  const [selected, setSelected] = useState(() => new Set(group.targets.filter((target) => target.selected !== false).map((target) => target.id)));
  const [version, setVersion] = useState(group.sources[0]?.content ?? '');

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resolveGroup = () => {
    resolve.mutate(
      {
        id: group.id,
        role,
        body: {
          targetIds: [...selected],
          selectedVersion: group.multiSourceType === 'B' ? version : undefined,
          content: group.resolvedContent ?? version,
        },
      },
      {
        onSuccess: () => showToast('멀티소스 항목을 반영했습니다.', 'ok'),
        onError: (error) => showToast(error instanceof Error ? error.message : '멀티소스 처리에 실패했습니다.', 'warn'),
      },
    );
  };

  const secondary = (action: 'split' | 'request-confirm') => {
    aux.mutate(
      { id: group.id, action },
      {
        onSuccess: () => showToast(action === 'split' ? '항목을 분리했습니다.' : '담당자 확인 요청을 보냈습니다.', 'ok'),
        onError: (error) => showToast(error instanceof Error ? error.message : '처리에 실패했습니다.', 'warn'),
      },
    );
  };

  return (
    <article className="card ms-card">
      <div className="rv-head">
        <div>
          <div className="row">
            <PriBadge value={group.priority} />
            <Badge tone="info">Type {group.multiSourceType}</Badge>
            <Certainty value={group.certainty} />
          </div>
          <h3>{group.topicTitle}</h3>
          <p className="muted">{group.description}</p>
        </div>
        <span className="count">{selected.size}</span>
      </div>

      <div className="ms-sources">
        {group.sources.map((source) => (
          <button
            className={`source-row ${version === source.content ? 'on' : ''}`}
            key={`${group.id}-${source.channel}-${source.time}`}
            type="button"
            onClick={() => setVersion(source.content)}
          >
            <div className="row">
              <strong>{source.channel}</strong>
              <span>{source.author}</span>
              <span>{source.time}</span>
            </div>
            <p>{source.content}</p>
          </button>
        ))}
      </div>

      <div className="ms-targets">
        {group.targets.map((target) => (
          <label className={`target-row ${selected.has(target.id) ? '' : 'disabled'}`} key={target.id}>
            <input checked={selected.has(target.id)} type="checkbox" onChange={() => toggle(target.id)} />
            <span onClick={() => openDoc(target.id, target.category)}>{target.title}</span>
          </label>
        ))}
      </div>

      <div className="row right">
        {group.multiSourceType === 'C' ? (
          <>
            <button type="button" onClick={() => secondary('split')}>분리</button>
            <button type="button" onClick={() => secondary('request-confirm')}>확인 요청</button>
          </>
        ) : (
          <button type="button" onClick={resolveGroup} disabled={selected.size === 0}>반영</button>
        )}
      </div>
    </article>
  );
}

export function ReviewDetailPanel() {
  const { review, setReviewDetail } = useUiStore();
  const { data: items = [] } = useReviewBoard();
  const item = items.find((candidate) => candidate.id === review.detailPanelItemId);
  if (!item) return null;

  return (
    <aside className="dp-ov" onClick={() => setReviewDetail(null)}>
      <section className="detail-panel" onClick={(event) => event.stopPropagation()}>
        <div className="rv-head">
          <div>
            <PriBadge value={item.priority} />
            <h2>{item.topicTitle}</h2>
          </div>
          <button type="button" onClick={() => setReviewDetail(null)}>×</button>
        </div>
        <p className="muted">{item.priorityReason}</p>
        {item.existing ? (
          <div className="card subtle">
            <strong>기존 기준</strong>
            <p>{item.existing.content}</p>
            <small>{item.existing.by} · {item.existing.establishedAt}</small>
          </div>
        ) : null}
        <div className="card subtle">
          <strong>신규 제안</strong>
          <p>{item.newContent}</p>
        </div>
        <div className="diff-list">
          {item.diff.map((line, index) => (
            <p className={`diff-${line.kind}`} key={`${item.id}-diff-${index}`}>{line.kind === 'add' ? '+' : '-'} {line.content}</p>
          ))}
        </div>
        <h3>{item.thread.type === 'slack' ? 'Slack thread' : 'Email thread'}</h3>
        {item.thread.messages.map((message, index) => (
          <div className={`thread-msg ${message.highlight ? 'hl' : ''}`} key={`${message.channel}-${index}`}>
            <div className="row">
              <Avatar name={message.author} />
              <strong>{message.author}</strong>
              <span>{message.time}</span>
            </div>
            <p>{message.content}</p>
          </div>
        ))}
        {item.thread.body ? <p>{item.thread.body}</p> : null}
      </section>
    </aside>
  );
}

export function ReviewPage() {
  const { review, setReviewTab } = useUiStore();
  const { data: items = [] } = useReviewBoard();
  const { data: groups = [] } = useMultiSource();
  const visibleItems = useMemo(() => items.filter((item) => !item.resolved && matchesTab(item, review.tab)), [items, review.tab]);
  const visibleGroups = useMemo(() => groups.filter((group) => !group.resolved && matchesTab(group, review.tab, true)), [groups, review.tab]);
  const total = items.filter((item) => !item.resolved).length + groups.filter((group) => !group.resolved).length;
  const p2Items = items.filter((item) => !item.resolved && item.priority === 'p2');
  const progress = total === 0 ? 100 : Math.round(((total - visibleItems.length - visibleGroups.length) / total) * 100);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.code === 'Space') setReviewTab('all');
      if (event.key.toLowerCase() === 'x') setReviewTab('ms');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setReviewTab]);

  return (
    <section className="page">
      <div className="rv-head">
        <div>
          <p className="eyebrow">Review Queue</p>
          <h1>검토 및 멀티소스 반영</h1>
        </div>
        <div className="rv-tabs">
          {tabs.map(([id, label]) => (
            <button className={review.tab === id ? 'on' : ''} key={id} type="button" onClick={() => setReviewTab(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="rv-prog"><span style={{ width: `${progress}%` }} /></div>
      <div className="row">
        <Badge tone="warn">{total} pending</Badge>
        <Badge tone="info">{groups.filter((group) => !group.resolved).length} multi-source</Badge>
        <Badge tone="ok">{p2Items.length} P2 batch</Badge>
      </div>

      {p2Items.length > 0 ? (
        <section className="card subtle">
          <div className="rv-head">
            <strong>P2 일괄 처리 후보</strong>
            <span>{p2Items.length}개</span>
          </div>
          <p className="muted">낮은 우선순위 항목은 큐를 유지한 채 개별 검토 흐름과 같은 API로 처리합니다.</p>
        </section>
      ) : null}

      <div className="review-grid">
        {visibleItems.map((item) => <ReviewCard item={item} key={item.id} />)}
        {visibleGroups.map((group) => <MultiSourceCard group={group} key={group.id} />)}
        {visibleItems.length === 0 && visibleGroups.length === 0 ? <div className="empty">현재 탭에 남은 검토 항목이 없습니다.</div> : null}
      </div>
    </section>
  );
}
