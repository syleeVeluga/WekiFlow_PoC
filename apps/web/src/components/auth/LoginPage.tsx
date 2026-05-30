import { useState, type FormEvent } from 'react';
import { ApiError, login } from '../../api/client.js';
import { useAuthStore } from '../../auth/store.js';

export function LoginPage() {
  const setSession = useAuthStore((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await login({ email, password });
      setSession(result.token, result.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '로그인에 실패했습니다.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-brand">V <em>WIKI</em></div>
        <h1>로그인</h1>
        <p className="muted">이메일로 로그인하세요.</p>
        <label>
          이메일
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin01@veluga.io"
            required
          />
        </label>
        <label>
          비밀번호
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error ? <p className="login-error">{error}</p> : null}
        <button className="btn-primary" type="submit" disabled={pending}>
          {pending ? '로그인 중…' : '로그인'}
        </button>
      </form>
    </div>
  );
}
