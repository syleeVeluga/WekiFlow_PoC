import type { DocumentDTO, JobRef, TreeNode, UserRole } from '@wf/shared';

const BASE = '/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
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

export function approve(id: string, role: UserRole): Promise<{ ok: true; doc: DocumentDTO; job: JobRef }> {
  return request(`/documents/${id}/approve`, {
    method: 'POST',
    headers: { 'x-user-role': role },
  });
}

export function reject(id: string): Promise<DocumentDTO> {
  return request(`/documents/${id}/reject`, { method: 'POST' });
}
