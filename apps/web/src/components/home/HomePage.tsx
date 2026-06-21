import { useDigest, useActivity } from '../../data/hooks.js';
import { useAuthStore } from '../../auth/store.js';
import { useUiStore } from '../../store.js';

export function HomePage() {
  const { data } = useDigest();
  const { data: activity = [] } = useActivity(5);
  const userName = useAuthStore((s) => s.user?.name ?? '');
  const go = useUiStore((s) => s.go);
  const openDoc = useUiStore((s) => s.openDoc);
  if (!data) return <div className="pg">Loading</div>;
  const metrics = [
    { label: '정상 운영 중', status: true },
    { label: '오늘 신규', value: data.metrics.todayNewCount, unit: '건', tone: 'ok' },
    { label: '오늘 분석', value: data.metrics.analysisCount, unit: '개 메시지' },
    { label: '추출 주제', value: data.metrics.extractedCount },
    { label: '검토 대기', value: data.metrics.pendingReview, tone: 'warn', onClick: () => go('review') },
    { label: '자동 처리', value: data.metrics.autoAppliedCount, unit: '건 처리됨' },
  ];
  const recentAutoApplied = data.sections
    .flatMap((section) => section.entities)
    .filter((entity) => entity.kind === 'new' || entity.kind === 'update')
    .slice(0, 4);
  const hasSections = data.sections.length > 0;
  return (
    <section className="pg home-wrap">
      <div className="home-hero"><div className="eyebrow">조직의 운영 기억</div><h1>안녕하세요, {userName}님</h1><p>{data.dateLabel} · WikiFlow가 오늘 새로 배운 운영 지식을 정리했습니다.</p></div>
      <div className="statusbar">
        {metrics.map((metric) => {
          const content = (
            <>
              {metric.status ? <span className="hsb-dot" /> : null}
              <span className="hsb-label">{metric.label}</span>
              {'value' in metric ? <span className={`hsb-num ${metric.tone ? `tone-${metric.tone}` : ''}`}>{metric.value}</span> : null}
              {'unit' in metric ? <span className="hsb-unit">{metric.unit}</span> : null}
            </>
          );
          return metric.onClick ? (
            <button key={metric.label} className="hsb-item clickable" type="button" onClick={metric.onClick}>{content}</button>
          ) : (
            <div key={metric.label} className={`hsb-item ${metric.status ? 'is-status' : ''}`}>{content}</div>
          );
        })}
      </div>
      <div className="digest-grid">
        <div className="card">
          <div className="digest-meta">
            <span className="digest-date">{data.dateLabel}</span>
            <span className="digest-live"><span className="digest-live-dot" />마지막 업데이트: {data.updatedAtLabel ?? '방금 전'}</span>
          </div>
          <h2>오늘, 조직이 새로 배운 것</h2>
          {data.topSearch ? <p>가장 자주 검색된 주제는 <b>{data.topSearch}</b>입니다.</p> : <p className="muted">아직 집계된 검색 주제가 없습니다.</p>}
          {!hasSections ? <div className="empty">아직 새로 정리된 지식이 없습니다.</div> : null}
          {data.sections.map((section) => (
            <div className="digest-section" key={section.title}>
              <h3>{section.title} {section.pill ? <span className="badge badge-info">{section.pill}</span> : null}</h3>
              {section.entities.map((entity) => (
                <p key={entity.itemId}>
                  <button className="dg-entity" type="button" onClick={() => openDoc(entity.itemId)}>{entity.title}</button>
                  {entity.quote ? ` — ${entity.quote} ` : ' '}
                  {entity.kind === 'conflict' ? <button className="dg-cite" type="button" onClick={() => go('review')}>[검토]</button> : null}
                </p>
              ))}
            </div>
          ))}
        </div>
        <div className="grid">
          <div className="card">
            <h3>최근 자동 반영 <button className="btn-ghost" onClick={() => go('history')}>전체 보기</button></h3>
            <div className="widget-list">
              {recentAutoApplied.length === 0 ? <div className="empty">자동 반영된 지식이 없습니다.</div> : null}
              {recentAutoApplied.map((entity) => (
                <button className="filter-row" key={`${entity.kind}-${entity.itemId}`} type="button" onClick={() => openDoc(entity.itemId)}>
                  <span>{entity.title}</span>
                  <small>{entity.kind === 'new' ? '신규 생성' : '자동 업데이트'}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="card"><h3>가장 많이 언급된 주제</h3><div className="widget-list">{data.mostAsked.length === 0 ? <div className="empty">표시할 주제가 없습니다.</div> : null}{data.mostAsked.map((m) => <div key={m.key}><b>{m.label}</b> {m.flag && <span className="badge badge-warn">{m.flag}</span>}<div className="bar"><span style={{ width: `${Math.min(100, m.count * 2)}%` }} /></div></div>)}</div></div>
          <div className="card"><h3>최근 활동</h3>{activity.length === 0 ? <div className="empty">표시할 활동이 없습니다.</div> : null}{activity.map((a) => <button className="filter-row" key={a.id} type="button" onClick={() => go('history')}><span>{a.actorLabel} · {a.targetTitle}</span><small>{a.time}</small></button>)}</div>
        </div>
      </div>
    </section>
  );
}
