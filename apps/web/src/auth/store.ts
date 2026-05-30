import { create } from 'zustand';
import type { User } from '@wf/shared';
import { setAuthToken } from '../api/client.js';

const TOKEN_KEY = 'wf.authToken';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function persistToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore storage failures (e.g. private mode) */
  }
}

type AuthStatus = 'loading' | 'authed' | 'anon';

interface AuthState {
  user: User | null;
  status: AuthStatus;
  /** Apply a fresh login: persist token, set client header, mark authed. */
  setSession: (token: string, user: User) => void;
  /** Set the current user (e.g. after /auth/me restore) without changing the token. */
  setUser: (user: User) => void;
  /** Mark unauthenticated (no valid session). */
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: 'loading',
  setSession: (token, user) => {
    persistToken(token);
    setAuthToken(token);
    set({ user, status: 'authed' });
  },
  setUser: (user) => set({ user, status: 'authed' }),
  clear: () => {
    persistToken(null);
    setAuthToken(null);
    set({ user: null, status: 'anon' });
  },
}));
