import { useDigest, useActivity } from '../../data/hooks.js';
import { useUiStore } from '../../store.js';
import { Avatar } from '../common/Primitives.js';

export function HomePage() {
  const { data } = useDigest();
  const { data: activity = [] } = useActivity(5);
  const go = useUiStore((s) => s.go);
  const openDoc = useUiStore((s) => s.openDoc);
  const setReviewTab = useUiStore((s) => s.setReviewTab);
  if (!data) return <div className="pg">Loading</div>;
  const metrics = [
    ['정상 운영', 'OK'],
    ['Slack', '12채널'],
    ['실패', data.metrics.failedCount],
    ['검토 대기', data.metrics.pendingReview],
    ['자동 처리', data.metrics.autoAppliedCount],
    ['미답변', data.metrics.unansweredCount],
  ];
  const recentAutoApplied = data.sections
    .flatMap((section) => section.entities)
    .filter((entity) => entity.kind === 'new' || entity.kind === 'update')
    .slice(0, 4);
  return (
    <section className="pg home-wrap">
      <div className="home-hero"><div className="eyebrow">조직의 운영 기억</div><h1>안녕하세요, 이지수님</h1><p>{data.dateLabel} · V WIKI가 오늘 새로 배운 운영 지식을 정리했습니다.</p></div>
      <div className="statusbar">
        {metrics.map(([label, value]) => (
          <button key={label} className="hsb-item clickable" type="button" onClick={() => label === '검토 대기' && go('review')}>
            <span className="hsb-label">{label}</span><span className="hsb-num">{value}</span>
          </button>
        ))}
      </div>
      <div className="digest-grid">
        <div className="card">
          <h2>오늘, 조직이 새로 배운 것</h2>
          <p>가장 자주 검색된 주제는 <b>{data.topSearch}</b>입니다.</p>
          {data.sections.map((section) => (
            <div className="digest-section" key={section.title}>
              <h3>{section.title} {section.pill ? <span className="badge badge-info">{section.pill}</span> : null}</h3>
              {section.entities.map((entity) => (
                <p key={entity.itemId}>
                  <button className="dg-entity" type="button" onClick={() => openDoc(entity.itemId)}>{entity.title}</button>
                  {entity.quote ? ` — ${entity.quote} ` : ' '}
                  {entity.kind === 'conflict' ? <button className="dg-cite" type="button" onClick={() => setReviewTab('p0')}>[검토]</button> : null}
                </p>
              ))}
            </div>
          ))}
        </div>
        <div className="grid">
          <div className="card">
            <h3>최근 자동 반영 <button className="btn-ghost" onClick={() => go('history')}>전체 보기</button></h3>
            <div className="widget-list">
              {recentAutoApplied.map((entity) => (
                <button className="filter-row" key={`${entity.kind}-${entity.itemId}`} type="button" onClick={() => openDoc(entity.itemId)}>
                  <span>{entity.title}</span>
                  <small>{entity.kind === 'new' ? '신규 생성' : '자동 업데이트'}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="card"><h3>가장 많이 언급된 주제 <button className="btn-ghost" onClick={() => go('review')}>답변하기</button></h3><div className="widget-list">{data.mostAsked.map((m) => <div key={m.key}><b>{m.label}</b> {m.flag && <span className="badge badge-warn">{m.flag}</span>}<div className="bar"><span style={{ width: `${Math.min(100, m.count * 2)}%` }} /></div></div>)}</div></div>
          <div className="card"><h3>담당자별 커버리지 <button className="btn-ghost" onClick={() => go('kb')}>전체 보기</button></h3><div className="widget-list">{data.coverage.map((c) => <div key={c.key}><Avatar name={c.label} /> <b>{c.label}</b> <span>{c.role}</span><span className={`badge badge-${c.tone ?? 'neutral'}`}>{c.flag}</span><div className="bar"><span style={{ width: `${Math.min(100, c.count * 3)}%` }} /></div></div>)}</div></div>
          <div className="card"><h3>최근 활동</h3>{activity.map((a) => <button className="filter-row" key={a.id} type="button" onClick={() => go('history')}><span>{a.actorLabel} · {a.targetTitle}</span><small>{a.time}</small></button>)}</div>
        </div>
      </div>
    </section>
  );
}
