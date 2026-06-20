import { lazy, Suspense, useState } from 'react';
import type { CandidateReviewItem, CandidateRouteResolveAction, DocumentDTO, MultiSourceGroup, ReviewItem } from '@wf/shared';
import { DOC_STATUS_TO_CANDIDATE, canApprove, canReview } from '@wf/shared';
import { useApprove, useCandidateReviewRoutes, useReject, useResolveCandidateRoute, useReviews, useSettings } from '../../api/hooks.js';
import { useMultiSource, useMultiSourceActions, useResolveMultiSource, useResolveReview, useReviewBoard } from '../../data/hooks.js';
import { useAuthStore } from '../../auth/store.js';
import { useUiStore } from '../../store.js';
import { Avatar, Badge, Certainty } from '../common/Primitives.js';
import { TrustLabel } from '../common/TrustLabel.js';

const MonacoDiffPane = lazy(async () => {
  const module = await import('../monaco/MonacoDiffPane.js');
  return { default: module.MonacoDiffPane };
});

const routeTitles: Record<CandidateReviewItem['route']['action'], string> = {
  auto_publish: '자동 게시 가능',
  needs_approval: '승인 필요',
  needs_source: '출처 확인 필요',
  reject: '충돌 보류',
};

function CandidateTriageCard({ item }: { item: CandidateReviewItem }) {
  const { showToast } = useUiStore();
  const resolve = useResolveCandidateRoute();
  const { candidate, route } = item;

  const act = (action: CandidateRouteResolveAction) => {
    resolve.mutate(
      { id: candidate.id, action },
      {
        onSuccess: () => showToast('후보 상태를 업데이트했습니다.', 'ok'),
        onError: (error) => showToast(error instanceof Error ? error.message : '후보 처리에 실패했습니다.', 'warn'),
      },
    );
  };

  return (
    <article className={`card ri-card triage-card triage-${route.action}`}>
      <div>
        <div className="row">
          <TrustLabel status={candidate.status} riskFactors={route.reasons} />
          <Badge tone={route.action === 'reject' || route.action === 'needs_source' ? 'warn' : 'info'}>{routeTitles[route.action]}</Badge>
        </div>
        <h3>{candidate.title}</h3>
        {candidate.summary ? <p className="muted">{candidate.summary}</p> : null}
        <p>{route.recommendedAction}</p>
        <div className="reason-list">
          {(route.reasonLabels.length > 0 ? route.reasonLabels : ['위험 요인 없음']).map((reason) => (
            <span key={`${candidate.id}-${reason}`}>{reason}</span>
          ))}
        </div>
        <div className="row sm">
          <span>{candidate.provenance.label ?? candidate.provenance.ref}</span>
          <span>{candidate.provenance.kind}</span>
          {route.approverRoles.length > 0 ? <span>승인: {route.approverRoles.join(', ')}</span> : null}
        </div>
      </div>
      <div className="ri-actions">
        {route.action === 'auto_publish' ? (
          <button type="button" onClick={() => act('auto_publish')} disabled={resolve.isPending}>게시</button>
        ) : null}
        {route.action === 'needs_source' ? (
          <button type="button" onClick={() => act('request_source')} disabled={resolve.isPending}>출처 요청</button>
        ) : null}
        {route.action === 'needs_approval' ? (
          <button type="button" onClick={() => act('approve')} disabled={!route.canApprove || resolve.isPending}>승인</button>
        ) : null}
        <button type="button" onClick={() => act('reject')} disabled={resolve.isPending}>보류</button>
      </div>
    </article>
  );
}

function CandidateTriageSection({ items }: { items: CandidateReviewItem[] }) {
  const groups = items.reduce<Record<CandidateReviewItem['route']['action'], CandidateReviewItem[]>>(
    (acc, item) => {
      acc[item.route.action].push(item);
      return acc;
    },
    { needs_approval: [], needs_source: [], reject: [], auto_publish: [] },
  );
  const ordered = (['needs_approval', 'needs_source', 'reject', 'auto_publish'] as const).filter((action) => groups[action].length > 0);

  return (
    <section className="candidate-triage">
      <div className="rv-head">
        <div>
          <p className="eyebrow">Triage</p>
          <h2>승인 사유 inbox</h2>
        </div>
      </div>
      {ordered.length === 0 ? <div className="empty">승인 사유 기반 후보가 없습니다.</div> : null}
      {ordered.map((action) => (
        <div className="reason-group" key={action}>
          <h3>{routeTitles[action]}</h3>
          <div className="review-grid">
            {groups[action].map((item) => (
              <CandidateTriageCard item={item} key={item.candidate.id} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function Layer1ReviewSection({ items }: { items: DocumentDTO[] }) {
  const role = useAuthStore((s) => s.user?.role ?? 'VIEWER');
  const { openDoc, showToast } = useUiStore();
  const approve = useApprove();
  const reject = useReject();
  const canApproveNow = canApprove(role);
  const canReviewNow = canReview(role);

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
      </div>
      <div className="review-grid">
        {items.map((doc) => (
          <article className="card ri-card layer1-card" key={doc.id}>
            <div className="rv-head">
              <div>
                <div className="row">
                  <TrustLabel status={DOC_STATUS_TO_CANDIDATE[doc.status]} />
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
          <TrustLabel status="NEEDS_APPROVAL" riskFactors={['official_answer']} />
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
  const { data: settings, isLoading: isSettingsLoading } = useSettings();
  const { data: layer1Reviews = [] } = useReviews();
  const { data: candidateRoutes = [] } = useCandidateReviewRoutes();
  const { data: items = [] } = useReviewBoard();
  const { data: groups = [] } = useMultiSource();
  const reviewApprovalEnabled = settings?.reviewApprovalEnabled ?? false;
  const visibleItems = items.filter((item) => !item.resolved && !review.rvDone[item.id]);
  const visibleGroups = groups.filter((group) => !group.resolved);
  const showPendingQueues = reviewApprovalEnabled || layer1Reviews.length > 0 || candidateRoutes.length > 0;
  const pending = showPendingQueues
    ? layer1Reviews.length + (reviewApprovalEnabled ? visibleItems.length + visibleGroups.length : 0)
    : 0;
  const totalPending = pending + candidateRoutes.length;
  // The progress bar charts the legacy review board, which keeps resolved items as a stable
  // denominator. Layer 1 reviews leave the dataset on approval (REVIEW → GRAPH_INDEXED), so they
  // have no completed-count to chart — they're surfaced via `pending` and their own section. Guard
  // against a false 100% while any work (including Layer 1) is still pending.
  const legacyTotal = items.length + groups.length;
  const legacyCompleted = legacyTotal - visibleItems.length - visibleGroups.length;
  const progress =
    totalPending > 0 ? (legacyTotal === 0 ? 0 : Math.round((legacyCompleted / legacyTotal) * 100)) : 100;

  return (
    <section className="page">
      <div className="rv-head">
        <div>
          <p className="eyebrow">Review</p>
          <h1>신규 검토 대상</h1>
        </div>
        <Badge tone="warn">{totalPending}건</Badge>
      </div>
      {isSettingsLoading ? (
        <div className="empty">검토 설정을 불러오는 중입니다.</div>
      ) : !showPendingQueues ? (
        <div className="review-disabled">
          <Badge tone="info">비활성화</Badge>
          <h2>검토 승인 기능이 꺼져 있습니다.</h2>
          <p>승인 권한을 가진 사용자가 설정 메뉴에서 검토 승인 활성화를 켜야 이 메뉴에서 검토할 수 있습니다.</p>
          <p className="muted">현재는 파이프라인 결과가 검토 단계에서 멈추지 않고 바로 게시 단계로 넘어갑니다.</p>
        </div>
      ) : (
        <>
      <div className="rv-prog"><span style={{ width: `${progress}%` }} /></div>
      <CandidateTriageSection items={candidateRoutes} />
      <Layer1ReviewSection items={layer1Reviews} />
      <div className="review-grid">
        {reviewApprovalEnabled ? visibleItems.map((item) => <ReviewCard item={item} key={item.id} />) : null}
        {reviewApprovalEnabled ? visibleGroups.map((group) => <MultiSourceCard group={group} key={group.id} />) : null}
        {totalPending === 0 ? <div className="empty">신규 검토 대상이 없습니다.</div> : null}
      </div>
        </>
      )}
    </section>
  );
}
