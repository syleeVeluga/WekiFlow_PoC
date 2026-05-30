import type { AuthResult, CreateUserBody, DocumentDTO, JobRef, LoginBody, TreeNode, User, UserRole } from '@wf/shared';

const BASE = '/api';

let authToken: string | null = null;

/** Set (or clear) the bearer token attached to every subsequent request. */
export function setAuthToken(token: string | null): void {
  authToken = token;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
  // Only declare a JSON body when one is actually sent — Fastify rejects an empty
  // body that carries `content-type: application/json` (used by bodyless POSTs like approve/logout).
  if (init?.body != null) headers['content-type'] = 'application/json';
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function login(body: LoginBody): Promise<AuthResult> {
  return request('/auth/login', { method: 'POST', body: JSON.stringify(body) });
}

export function fetchMe(): Promise<User> {
  return request('/auth/me');
}

export function logout(): Promise<{ ok: boolean }> {
  return request('/auth/logout', { method: 'POST' });
}

export function listUsers(): Promise<User[]> {
  return request('/users');
}

export function createUser(body: CreateUserBody): Promise<User> {
  return request('/users', { method: 'POST', body: JSON.stringify(body) });
}

export function updateUserRole(id: string, role: UserRole): Promise<User> {
  return request(`/users/${id}`, { method: 'PATCH', body: JSON.stringify({ role }) });
}

export function deleteUser(id: string): Promise<{ ok: boolean }> {
  return request(`/users/${id}`, { method: 'DELETE' });
}

export function fetchTree(): Promise<TreeNode[]> {
  return request<TreeNode[]>('/tree');
}

export function fetchDocument(id: string): Promise<DocumentDTO> {
  return request<DocumentDTO>(`/documents/${id}`);
}

export function fetchReviews(): Promise<DocumentDTO[]> {
  return request<DocumentDTO[]>('/reviews');
}

export function ingest(input: {
  title: string;
  contentMarkdown: string;
  parentId?: string | null;
}): Promise<{ doc: DocumentDTO; job: JobRef }> {
  return request('/ingest', { method: 'POST', body: JSON.stringify(input) });
}

export function approve(id: string): Promise<{ ok: true; doc: DocumentDTO; job: JobRef }> {
  return request(`/documents/${id}/approve`, { method: 'POST' });
}

export function reject(id: string): Promise<DocumentDTO> {
  return request(`/documents/${id}/reject`, { method: 'POST' });
}
