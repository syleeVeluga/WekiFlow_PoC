import type {
  AgentPreviewRequest,
  AgentPreviewRun,
  AppSettings,
  AuthResult,
  CreateUserBody,
  DocumentConnections,
  DocumentDTO,
  IngestRequest,
  JobRef,
  LoginBody,
  TrashEntry,
  TreeNode,
  UpdateUserRoleBody,
  User,
  UserRole,
  UpdateAppSettings,
} from '@wf/shared';

const BASE = '/api';

let authToken: string | null = null;

/** Set (or clear) the bearer token attached to every subsequent request. */
export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
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

export function fetchSettings(): Promise<AppSettings> {
  return request('/settings');
}

export function updateSettings(body: UpdateAppSettings): Promise<AppSettings> {
  return request('/settings', { method: 'PATCH', body: JSON.stringify(body) });
}

export function listUsers(): Promise<User[]> {
  return request('/users');
}

export function createUser(body: CreateUserBody): Promise<User> {
  return request('/users', { method: 'POST', body: JSON.stringify(body) });
}

export function updateUserRole(id: string, body: UpdateUserRoleBody): Promise<User> {
  return request(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
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

export function fetchConnections(id: string): Promise<DocumentConnections> {
  return request<DocumentConnections>(`/documents/${id}/connections`);
}

export function trashDocument(id: string): Promise<{ ok: boolean }> {
  return request(`/documents/${id}`, { method: 'DELETE' });
}

export function fetchTrash(): Promise<TrashEntry[]> {
  return request<TrashEntry[]>('/trash');
}

export function restoreTrash(id: string): Promise<{ ok: boolean }> {
  return request(`/trash/${id}/restore`, { method: 'POST' });
}

export function purgeTrash(id: string): Promise<{ ok: boolean }> {
  return request(`/trash/${id}`, { method: 'DELETE' });
}

export function ingest(input: IngestRequest): Promise<{ doc: DocumentDTO; job: JobRef }> {
  return request('/ingest', { method: 'POST', body: JSON.stringify(input) });
}

export type IngestFileMeta = Partial<Omit<IngestRequest, 'contentMarkdown' | 'title'>> & { title?: string };

function appendIngestFileMeta(form: FormData, meta: IngestFileMeta) {
  if (meta.title?.trim()) form.append('title', meta.title.trim());
  if (meta.parentId) form.append('parentId', meta.parentId);
  if (meta.topic) form.append('topic', meta.topic);
  if (meta.workspace) form.append('workspace', meta.workspace);
  if (meta.department) form.append('department', meta.department);
  if (meta.sourceLabel) form.append('sourceLabel', meta.sourceLabel);
}

async function multipartRequest<T>(path: string, form: FormData): Promise<T> {
  const headers: Record<string, string> = {};
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: form });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function ingestFile(file: File, meta: IngestFileMeta): Promise<{ doc: DocumentDTO; job: JobRef }> {
  const form = new FormData();
  form.append('file', file);
  appendIngestFileMeta(form, meta);
  return multipartRequest('/ingest/file', form);
}

export async function ingestFiles(files: File[], meta: IngestFileMeta): Promise<{ items: Array<{ doc: DocumentDTO; job: JobRef; fileName: string }> }> {
  const form = new FormData();
  for (const file of files) form.append('file', file);
  appendIngestFileMeta(form, meta);
  return multipartRequest('/ingest/files', form);
}

export function approve(id: string): Promise<{ ok: true; doc: DocumentDTO; job: JobRef }> {
  return request(`/documents/${id}/approve`, { method: 'POST' });
}

export function reject(id: string): Promise<DocumentDTO> {
  return request(`/documents/${id}/reject`, { method: 'POST' });
}

export function agentPreviewMessage(body: AgentPreviewRequest): Promise<{ jobId: string; documentId: string }> {
  return request('/agent-preview', { method: 'POST', body: JSON.stringify(body) });
}

export async function agentPreviewUpload(file: File, title?: string, commit = false): Promise<{ jobId: string; documentId: string }> {
  const form = new FormData();
  form.append('file', file);
  if (title?.trim()) form.append('title', title.trim());
  if (commit) form.append('commit', 'true');
  return multipartRequest('/agent-preview', form);
}

export function fetchAgentPreview(jobId: string): Promise<AgentPreviewRun> {
  return request(`/agent-preview/${jobId}`);
}

export function listAgentPreviews(): Promise<AgentPreviewRun[]> {
  return request('/agent-preview');
}

export function agentPreviewStreamUrl(jobId: string): string {
  const token = encodeURIComponent(authToken ?? '');
  return `${BASE}/agent-preview/${jobId}/stream?token=${token}`;
}
