import type { ActivePage } from '../../store.js';

export function NavItem({
  page,
  active,
  icon,
  label,
  badge,
  badgeClass,
  onClick,
}: {
  page: ActivePage;
  active: ActivePage;
  icon: string;
  label: string;
  badge?: number;
  badgeClass?: string;
  onClick: (page: ActivePage) => void;
}) {
  return (
    <button className={`ni ${active === page ? 'on' : ''}`} type="button" onClick={() => onClick(page)}>
      <span>{icon}</span>
      <span>{label}</span>
      {badge != null ? <b className={badgeClass}>{badge}</b> : null}
    </button>
  );
}
