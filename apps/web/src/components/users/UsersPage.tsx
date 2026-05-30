import { useState, type FormEvent } from 'react';
import { canManageOwners, canManageUsers, roleLabels, userRoles, type UserRole } from '@wf/shared';
import { ApiError } from '../../api/client.js';
import { useAuthStore } from '../../auth/store.js';
import { useUsers, useUserMutations } from '../../data/users.js';
import { useUiStore } from '../../store.js';

export function UsersPage() {
  const me = useAuthStore((s) => s.user);
  const showToast = useUiStore((s) => s.showToast);
  const { data: users = [] } = useUsers();
  const { create, updateRole, remove } = useUserMutations();
  const [form, setForm] = useState<{ name: string; email: string; role: UserRole }>({ name: '', email: '', role: 'VIEWER' });

  if (!me || !canManageUsers(me.role)) {
    return (
      <section className="pg stub">
        <h1>접근 권한이 없습니다</h1>
        <p className="muted">사용자 관리는 승인·소유자 권한만 이용할 수 있습니다.</p>
      </section>
    );
  }

  const isOwner = canManageOwners(me.role);
  const toastErr = (err: unknown) => showToast(err instanceof ApiError ? err.message : '처리에 실패했습니다.', 'warn');

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(form, {
      onSuccess: () => {
        showToast('사용자를 추가했습니다.', 'ok');
        setForm({ name: '', email: '', role: 'VIEWER' });
      },
      onError: toastErr,
    });
  };

  // 승인 권한자는 소유자 역할을 부여할 수 없다(소유자만 가능).
  const assignableRoles = userRoles.filter((role) => isOwner || role !== 'OWNER');

  return (
    <section className="pg users-page">
      <div className="topbar">
        <div>
          <h1>사용자 관리</h1>
          <p>{users.length}명 · 비밀번호는 이메일과 동일하게 발급됩니다.</p>
        </div>
      </div>

      <form className="card user-add" onSubmit={onCreate}>
        <h3>사용자 추가</h3>
        <div className="user-add-row">
          <input placeholder="이름" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input type="email" placeholder="이메일" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}>
            {assignableRoles.map((role) => (
              <option key={role} value={role}>{roleLabels[role]}</option>
            ))}
          </select>
          <button className="btn-primary" type="submit" disabled={create.isPending}>추가</button>
        </div>
      </form>

      <div className="card">
        <table className="user-table">
          <thead>
            <tr><th>이름</th><th>이메일</th><th>권한</th><th aria-label="작업" /></tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const lockOwnerRow = user.role === 'OWNER' && !isOwner;
              const roleOptions = userRoles.filter((role) => isOwner || role !== 'OWNER' || user.role === 'OWNER');
              return (
                <tr key={user.id}>
                  <td>{user.name}{user.id === me.id ? ' (나)' : ''}</td>
                  <td>{user.email}</td>
                  <td>
                    <select
                      value={user.role}
                      disabled={lockOwnerRow || updateRole.isPending}
                      onChange={(e) =>
                        updateRole.mutate(
                          { id: user.id, role: e.target.value as UserRole },
                          { onSuccess: () => showToast('권한을 변경했습니다.', 'ok'), onError: toastErr },
                        )
                      }
                    >
                      {roleOptions.map((role) => (
                        <option key={role} value={role}>{roleLabels[role]}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      className="btn"
                      disabled={user.id === me.id || lockOwnerRow || remove.isPending}
                      onClick={() =>
                        remove.mutate(user.id, {
                          onSuccess: () => showToast('사용자를 삭제했습니다.', 'ok'),
                          onError: toastErr,
                        })
                      }
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
