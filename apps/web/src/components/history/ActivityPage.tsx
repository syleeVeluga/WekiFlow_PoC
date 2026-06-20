import { useActivity } from '../../data/hooks.js';
import { Badge } from '../common/Primitives.js';

const ACTIVITY_KIND_LABEL = {
  create: '신규 생성',
  edit: '수정',
  detect: '감지',
} as const;

export function ActivityPage() {
  const { data: activity = [], isLoading } = useActivity(30);

  return (
    <section className="page activity-page">
      <div className="rv-head">
        <div>
          <p className="eyebrow">운영 기록</p>
          <h1>변경 이력</h1>
        </div>
        <Badge>{activity.length}건</Badge>
      </div>

      <div className="activity-list">
        {activity.map((item) => (
          <div className="activity-row" key={item.id}>
            <span>{item.actorLabel}</span>
            <strong>{item.targetTitle}</strong>
            <small>{ACTIVITY_KIND_LABEL[item.kind]} · {item.time}</small>
          </div>
        ))}
        {isLoading ? <div className="empty">변경 이력을 불러오는 중입니다.</div> : null}
        {!isLoading && activity.length === 0 ? <div className="empty">표시할 변경 이력이 없습니다.</div> : null}
      </div>
    </section>
  );
}
