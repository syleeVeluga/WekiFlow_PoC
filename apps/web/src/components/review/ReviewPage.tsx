import { lazy, Suspense, useState } from 'react';
import type { DocumentDTO, MultiSourceGroup, ReviewItem } from '@wf/shared';
import { canApprove, canReview } from '@wf/shared';
import { useApprove, useReject, useReviews } from '../../api/hooks.js';
import { useMultiSource, useMultiSourceActions, useResolveMultiSource, useResolveReview, useReviewBoard } from '../../data/hooks.js';
import { useAuthStore } from '../../auth/store.js';
import { useUiStore } from '../../store.js';
import { Avatar, Badge, Certainty } from '../common/Primitives.js';

const MonacoDiffPane = lazy(async () => {
  const module = await import('../monaco/MonacoDiffPane.js');
  return { default: module.MonacoDiffPane };
});

function Layer1ReviewSection({ items }: { items: DocumentDTO[] }) {
  const role = useAuthStore((s) => s.user?.role ?? 'VIEWER');
  const { openDoc, showToast } = useUiStore();
  const approve = useApprove();
  const reject = useReject();
  const [enabled, setEnabled] = useState(false);
  const canApproveNow = enabled && canApprove(role);
  const canReviewNow = enabled && canReview(role);

  const act = (action: 'approve' | 'reject', id: string) => {
    if (action === 'approve') {
      approve.mutate(
        { id },
        {
          onSuccess: () => showToast('승인했습니다.', 'ok'),
          onError: (error) => showToast(error instanceof Error ? error.message : '처리에 실패했습니다.', 'warn'),
        },
      );
      return;
    }
    reject.mutate(
      id,
      {
        onSuccess: () => showToast('반려했습니다.', 'ok'),
        onError: (error) => showToast(error instanceof Error ? error.message : '처리에 실패했습니다.', 'warn'),
      },
    );
  };

  return (
    <section className="layer1-review">
      <div className="rv-head">
        <div>
          <p className="eyebrow">Layer 1</p>
          <h2>파이프라인 검토</h2>
        </div>
        <label className="review-enable">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <span>승인 활성화</span>
        </label>
      </div>
      <div className="review-grid">
        {items.map((doc) => (
          <article className="card ri-card layer1-card" key={doc.id}>
            <div className="rv-head">
              <div>
                <div className="row">
                  <Badge tone="info">{doc.status}</Badge>
                  <button type="button" className="link-btn" onClick={() => openDoc(doc.id)}>문서 열기</button>
                </div>
                <h3>{doc.title}</h3>
              </div>
              <div className="ri-actions">
                <button type="button" onClick={() => act('reject', doc.id)} disabled={!canReviewNow || reject.isPending}>반려</button>
                <button type="button" onClick={() => act('approve', doc.id)} disabled={!canApproveNow || approve.isPending}>승인</button>
              </div>
            </div>
            <Suspense fallback={<div className="panel">Diff loading</div>}>
              <MonacoDiffPane original={doc.contentMarkdown} modified={doc.draftMarkdown ?? doc.contentMarkdown} />
            </Suspense>
          </article>
        ))}
        {items.length === 0 ? <div className="empty">파이프라인 검토 대상이 없습니다.</div> : null}
      </div>
    </section>
  );
}

function ReviewCard({ item }: { item: ReviewItem }) {
  const { review, setReviewDetail, markReviewDone, showToast } = useUiStore();
  const role = useAuthStore((s) => s.user?.role ?? 'VIEWER');
  const resolve = useResolveReview();
  const done = review.rvDone[item.id] || item.resolved;

  const act = (action: 'approve' | 'reject') => {
    resolve.mutate(
      { id: item.id, action },
      {
        onSuccess: () => {
          markReviewDone(item.id);
          showToast(action === 'approve' ? '승인했습니다.' : '반려했습니다.', 'ok');
        },
        onError: (error) => showToast(error instanceof Error ? error.message : '처리에 실패했습니다.', 'warn'),
      },
    );
  };

  return (
    <article className={`card ri-card ${done ? 'gone' : ''}`}>
      <div>
        <div className="row">
          <Badge tone="info">신규 검토 대상</Badge>
          <Certainty value={item.certainty} />
          <Badge>{item.changeType}</Badge>
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
      <div className="ri-actions">
        <button type="button" title="검토" onClick={() => setReviewDetail(item.id)} disabled={!canReview(role)}>
          검토
        </button>
        <button type="button" title="반려" onClick={() => act('reject')} disabled={!canReview(role)}>
          반려
        </button>
        <button type="button" title="승인" onClick={() => act('approve')} disabled={!canApprove(role)}>
          승인
        </button>
      </div>
    </article>
  );
}

function MultiSourceCard({ group }: { group: MultiSourceGroup }) {
  const { showToast, openDoc } = useUiStore();
  const role = useAuthStore((s) => s.user?.role ?? 'VIEWER');
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
        onSuccess: () => showToast(action === 'split' ? '항목을 분리했습니다.' : '사용자 확인 요청을 보냈습니다.', 'ok'),
        onError: (error) => showToast(error instanceof Error ? error.message : '처리에 실패했습니다.', 'warn'),
      },
    );
  };

  return (
    <article className="card ms-card">
      <div className="rv-head">
        <div>
          <div className="row">
            <Badge tone="info">Multi-source</Badge>
            <Badge>Type {group.multiSourceType}</Badge>
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
            <button type="button" onClick={() => secondary('split')} disabled={!canReview(role)}>분리</button>
            <button type="button" onClick={() => secondary('request-confirm')} disabled={!canReview(role)}>확인 요청</button>
          </>
        ) : (
          <button type="button" onClick={resolveGroup} disabled={selected.size === 0 || !canApprove(role)}>반영</button>
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
            <Badge tone="info">검토</Badge>
            <h2>{item.topicTitle}</h2>
          </div>
          <button type="button" onClick={() => setReviewDetail(null)}>닫기</button>
        </div>
        <p className="muted">{item.reason}</p>
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
  const { review } = useUiStore();
  const { data: layer1Reviews = [] } = useReviews();
  const { data: items = [] } = useReviewBoard();
  const { data: groups = [] } = useMultiSource();
  const visibleItems = items.filter((item) => !item.resolved && !review.rvDone[item.id]);
  const visibleGroups = groups.filter((group) => !group.resolved);
  const pending = layer1Reviews.length + visibleItems.length + visibleGroups.length;
  // The progress bar charts the legacy review board, which keeps resolved items as a stable
  // denominator. Layer 1 reviews leave the dataset on approval (REVIEW → GRAPH_INDEXED), so they
  // have no completed-count to chart — they're surfaced via `pending` and their own section. Guard
  // against a false 100% while any work (including Layer 1) is still pending.
  const legacyTotal = items.length + groups.length;
  const legacyCompleted = legacyTotal - visibleItems.length - visibleGroups.length;
  const progress =
    pending > 0 ? (legacyTotal === 0 ? 0 : Math.round((legacyCompleted / legacyTotal) * 100)) : 100;

  return (
    <section className="page">
      <div className="rv-head">
        <div>
          <p className="eyebrow">Review</p>
          <h1>신규 검토 대상</h1>
        </div>
        <Badge tone="warn">{pending}건</Badge>
      </div>
      <div className="rv-prog"><span style={{ width: `${progress}%` }} /></div>
      <Layer1ReviewSection items={layer1Reviews} />
      <div className="review-grid">
        {visibleItems.map((item) => <ReviewCard item={item} key={item.id} />)}
        {visibleGroups.map((group) => <MultiSourceCard group={group} key={group.id} />)}
        {pending === 0 ? <div className="empty">신규 검토 대상이 없습니다.</div> : null}
      </div>
    </section>
  );
}
