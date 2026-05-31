import { useMemo, useState } from 'react';
import { canManageOwners, canManageUsers, roleLabels } from '@wf/shared';
import { useKnowledgeItems, useMultiSource, useReviewBoard } from '../../data/hooks.js';
import { logout } from '../../api/client.js';
import { useAuthStore } from '../../auth/store.js';
import { useUiStore } from '../../store.js';
import { Avatar } from '../common/Primitives.js';
import { LnbDocumentTree } from './DocumentTree.js';
import { NavItem } from './NavItem.js';

export function Lnb() {
  const activePage = useUiStore((s) => s.activePage);
  const go = useUiStore((s) => s.go);
  const showToast = useUiStore((s) => s.showToast);
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const [menuOpen, setMenuOpen] = useState(false);
  const { data: reviews = [] } = useReviewBoard();
  const { data: multi = [] } = useMultiSource();
  const { data: knowledge = [] } = useKnowledgeItems({ person: 'all', topic: 'all', tag: null, status: 'all', q: '', sort: 'uses' });
  const pending = useMemo(() => reviews.length + multi.length, [reviews.length, multi.length]);
  const nav = (page: Parameters<typeof go>[0]) => {
    if (['sources', 'rules', 'history', 'add'].includes(page)) showToast('준비 중입니다.', 'inf');
    go(page);
  };

  const onLogout = () => {
    setMenuOpen(false);
    void logout().finally(() => clear());
  };

  return (
    <aside className="sb">
      <div className="sb-logo"><span>☰</span><span>Wiki<em>Flow</em></span></div>
      <div className="sb-workspace"><Avatar name="총" /><div><strong>총무팀</strong><small>운영 워크스페이스</small></div><span>▾</span></div>
      <NavItem page="home" active={activePage} icon="⌂" label="홈" onClick={nav} />
      <NavItem page="review" active={activePage} icon="◰" label="검토" badge={pending} badgeClass="nb-red" onClick={nav} />
      <NavItem page="kb" active={activePage} icon="◈" label="조직 지식" badge={knowledge.length} badgeClass="nb-blue" onClick={nav} />
      <div className="sb-sec-label">System</div>
      <NavItem page="sources" active={activePage} icon="⌁" label="데이터 소스" onClick={nav} />
      <NavItem page="rules" active={activePage} icon="⚙" label="처리 규칙" onClick={nav} />
      <NavItem page="history" active={activePage} icon="↺" label="변경 이력" onClick={nav} />
      <NavItem page="add" active={activePage} icon="+" label="직접 추가" onClick={nav} />
      <div className="sb-sec-label">Document Tree</div>
      <LnbDocumentTree />
      <div className="sb-user">
        <Avatar name={user?.name ?? '?'} />
        <div className="sb-user-info"><strong>{user?.name ?? ''}</strong><small>{user ? roleLabels[user.role] : ''}</small></div>
        <button type="button" className="sb-gear" title="설정" onClick={() => setMenuOpen((open) => !open)}>⚙</button>
        {menuOpen ? (
          <div className="sb-menu" onMouseLeave={() => setMenuOpen(false)}>
            {user && canManageUsers(user.role) ? (
              <button type="button" onClick={() => { setMenuOpen(false); go('users'); }}>사용자 관리</button>
            ) : null}
            {user && canManageOwners(user.role) ? (
              <button type="button" onClick={() => { setMenuOpen(false); go('agent'); }}>에이전트 미리보기</button>
            ) : null}
            <button type="button" onClick={onLogout}>로그아웃</button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
