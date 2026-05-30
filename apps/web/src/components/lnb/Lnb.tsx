import { useMemo } from 'react';
import { useKnowledgeItems, useMultiSource, useReviewBoard } from '../../data/hooks.js';
import { useUiStore } from '../../store.js';
import { Avatar } from '../common/Primitives.js';
import { LnbDocumentTree } from './DocumentTree.js';
import { NavItem } from './NavItem.js';

export function Lnb() {
  const activePage = useUiStore((s) => s.activePage);
  const go = useUiStore((s) => s.go);
  const showToast = useUiStore((s) => s.showToast);
  const { data: reviews = [] } = useReviewBoard();
  const { data: multi = [] } = useMultiSource();
  const { data: knowledge = [] } = useKnowledgeItems({ person: 'all', topic: 'all', tag: null, status: 'all', q: '', sort: 'uses' });
  const pending = useMemo(() => reviews.length + multi.length, [reviews.length, multi.length]);
  const nav = (page: Parameters<typeof go>[0]) => {
    if (['sources', 'rules', 'history', 'add'].includes(page)) showToast('준비 중입니다.', 'inf');
    go(page);
  };

  return (
    <aside className="sb">
      <div className="sb-logo"><span>☰</span><span>V <em>WIKI</em></span></div>
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
      <div className="sb-user"><Avatar name="이지수" /><div><strong>이지수</strong><small>총무팀장 · 지식 관리자</small></div></div>
    </aside>
  );
}
