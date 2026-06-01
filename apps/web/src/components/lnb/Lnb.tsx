import { useState } from 'react';
import { canApprove, canEdit, canManageOwners, canManageUsers, roleLabels } from '@wf/shared';
import { usePublished, useReviews, useSettings, useUpdateSettings } from '../../api/hooks.js';
import { logout } from '../../api/client.js';
import { useAuthStore } from '../../auth/store.js';
import { useUiStore } from '../../store.js';
import { Avatar } from '../common/Primitives.js';
import { LnbDocumentTree } from './DocumentTree.js';
import { NavItem } from './NavItem.js';

function WorkspaceSwitcher() {
  const workspaces = useUiStore((s) => s.workspaces);
  const activeWorkspaceId = useUiStore((s) => s.activeWorkspaceId);
  const createWorkspace = useUiStore((s) => s.createWorkspace);
  const renameWorkspace = useUiStore((s) => s.renameWorkspace);
  const deleteWorkspace = useUiStore((s) => s.deleteWorkspace);
  const selectWorkspace = useUiStore((s) => s.selectWorkspace);
  const showToast = useUiStore((s) => s.showToast);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const active = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0]!;

  const saveName = (id: string, currentName: string) => {
    const nextName = (draftNames[id] ?? currentName).trim();
    if (!nextName) return;
    renameWorkspace(id, nextName);
    showToast('워크스페이스 이름을 변경했습니다.', 'ok');
  };

  return (
    <div className="sb-workspace-wrap">
      <button type="button" className="sb-workspace" onClick={() => setOpen((value) => !value)}>
        <Avatar name={active.name.slice(0, 1)} />
        <div><strong>{active.name}</strong><small>{active.subtitle}</small></div>
        <span>▾</span>
      </button>
      {open ? (
        <div className="sb-workspace-menu">
          <div className="sb-workspace-list">
            {workspaces.map((workspace) => {
              const draftName = draftNames[workspace.id] ?? workspace.name;
              return (
                <div className={`sb-workspace-row ${workspace.id === activeWorkspaceId ? 'on' : ''}`} key={workspace.id}>
                  <button
                    type="button"
                    className="sb-workspace-pick"
                    title="선택"
                    onClick={() => selectWorkspace(workspace.id)}
                  >
                    {workspace.id === activeWorkspaceId ? '✓' : '○'}
                  </button>
                  <input
                    aria-label={`${workspace.name} 이름`}
                    value={draftName}
                    onChange={(event) => setDraftNames((names) => ({ ...names, [workspace.id]: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') saveName(workspace.id, workspace.name);
                    }}
                  />
                  <button type="button" className="sb-workspace-icon" title="이름 저장" onClick={() => saveName(workspace.id, workspace.name)}>↵</button>
                  <button
                    type="button"
                    className="sb-workspace-icon danger"
                    title="삭제"
                    disabled={workspaces.length <= 1}
                    onClick={() => deleteWorkspace(workspace.id)}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
          <form
            className="sb-workspace-create"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = newName.trim();
              if (!trimmed) return;
              createWorkspace(trimmed);
              setNewName('');
              showToast('워크스페이스를 추가했습니다.', 'ok');
            }}
          >
            <input value={newName} placeholder="새 워크스페이스" onChange={(event) => setNewName(event.target.value)} />
            <button type="submit" title="추가" disabled={!newName.trim()}>+</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export function Lnb() {
  const activePage = useUiStore((s) => s.activePage);
  const go = useUiStore((s) => s.go);
  const showToast = useUiStore((s) => s.showToast);
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const [menuOpen, setMenuOpen] = useState(false);
  const { data: reviews = [] } = useReviews();
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const { data: published = [] } = usePublished();
  const nav = (page: Parameters<typeof go>[0]) => {
    go(page);
  };

  const onLogout = () => {
    setMenuOpen(false);
    void logout().finally(() => clear());
  };

  return (
    <aside className="sb">
      <div className="sb-logo"><span>☰</span><span>Wiki<em>Flow</em></span></div>
      <WorkspaceSwitcher />
      <NavItem page="home" active={activePage} icon="⌂" label="홈" onClick={nav} />
      <NavItem
        page="review"
        active={activePage}
        icon="◰"
        label="검토"
        badge={settings?.reviewApprovalEnabled || reviews.length > 0 ? reviews.length : 0}
        badgeClass="nb-red"
        onClick={nav}
      />
      <NavItem page="kb" active={activePage} icon="◈" label="조직 지식" badge={published.length} badgeClass="nb-blue" onClick={nav} />
      <div className="sb-sec-label">System</div>
      <NavItem page="sources" active={activePage} icon="⌁" label="데이터 소스" onClick={nav} />
      <NavItem page="rules" active={activePage} icon="⚙" label="처리 규칙" onClick={nav} />
      <NavItem page="history" active={activePage} icon="↺" label="변경 이력" onClick={nav} />
      {user && canEdit(user.role) ? <NavItem page="trash" active={activePage} icon="🗑" label="휴지통" onClick={nav} /> : null}
      <NavItem page="add" active={activePage} icon="+" label="직접 추가" onClick={nav} />
      <div className="sb-sec-label">Document Tree</div>
      <LnbDocumentTree />
      <div className="sb-user">
        <Avatar name={user?.name ?? '?'} />
        <div className="sb-user-info"><strong>{user?.name ?? ''}</strong><small>{user ? roleLabels[user.role] : ''}</small></div>
        <button type="button" className="sb-gear" title="설정" onClick={() => setMenuOpen((open) => !open)}>⚙</button>
        {menuOpen ? (
          <div className="sb-menu" onMouseLeave={() => setMenuOpen(false)}>
            {user && canApprove(user.role) ? (
              <label className="sb-menu-toggle">
                <span>검토 승인 활성화</span>
                <input
                  type="checkbox"
                  checked={settings?.reviewApprovalEnabled ?? false}
                  disabled={updateSettings.isPending}
                  onChange={(event) => {
                    updateSettings.mutate(
                      { reviewApprovalEnabled: event.target.checked },
                      {
                        onSuccess: (next) => showToast(next.reviewApprovalEnabled ? '검토 승인을 활성화했습니다.' : '검토 승인을 비활성화했습니다.', 'ok'),
                        onError: (error) => showToast(error instanceof Error ? error.message : '설정 변경에 실패했습니다.', 'warn'),
                      },
                    );
                  }}
                />
              </label>
            ) : null}
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
