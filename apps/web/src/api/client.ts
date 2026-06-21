import type {
  AgentPreviewRequest,
  AgentPreviewRun,
  AppSettings,
  AskResponse,
  AuthResult,
  ConversationIngestRequest,
  ConversationIngestResult,
  CreateKnowledgeCandidate,
  CreateUserBody,
  DocumentConnections,
  DocumentDTO,
  IngestRequest,
  JobRef,
  CandidateReviewItem,
  CandidateRouteResolveAction,
  KnowledgeCandidate,
  KnowledgeCandidateListQuery,
  LoginBody,
  RuntimeConfigPatch,
  RuntimeConfigResponse,
  TrashEntry,
  TreeNode,
  UpdateKnowledgeCandidateStatus,
  UpdateUserRoleBody,
  User,
  UserRole,
  UpdateAppSettings,
} from '@wf/shared';

const BASE = '/api';

export type RuntimePolicy = Record<string, unknown>;
export interface RuntimePolicyResponse {
  defaults: RuntimePolicy;
  overrides: RuntimePolicy | null;
  effective: RuntimePolicy;
}

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

export function fetchRuntimeConfig(): Promise<RuntimeConfigResponse> {
  return request('/admin/config');
}

export function updateRuntimeConfig(body: RuntimeConfigPatch): Promise<RuntimeConfigResponse> {
  return request('/admin/config', { method: 'PATCH', body: JSON.stringify(body) });
}

export function fetchPolicy(): Promise<RuntimePolicyResponse> {
  return request('/admin/policy');
}

export function updatePolicy(body: RuntimePolicy | null): Promise<RuntimePolicyResponse> {
  return request('/admin/policy', { method: 'PUT', body: JSON.stringify(body) });
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

function candidateQuery(input: KnowledgeCandidateListQuery = {}): string {
  const params = new URLSearchParams();
  if (input.status) params.set('status', input.status);
  if (input.riskFactor) params.set('riskFactor', input.riskFactor);
  if (input.provenanceKind) params.set('provenanceKind', input.provenanceKind);
  if (input.workspaceId) params.set('workspaceId', input.workspaceId);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function fetchCandidates(input: KnowledgeCandidateListQuery = {}): Promise<KnowledgeCandidate[]> {
  return request<KnowledgeCandidate[]>(`/candidates${candidateQuery(input)}`);
}

export function fetchCandidateReviewRoutes(input: KnowledgeCandidateListQuery = {}): Promise<CandidateReviewItem[]> {
  return request<CandidateReviewItem[]>(`/candidate-review-routes${candidateQuery(input)}`);
}

export function fetchCandidate(id: string): Promise<KnowledgeCandidate> {
  return request<KnowledgeCandidate>(`/candidates/${id}`);
}

export function createCandidate(input: CreateKnowledgeCandidate): Promise<KnowledgeCandidate> {
  return request<KnowledgeCandidate>('/candidates', { method: 'POST', body: JSON.stringify(input) });
}

export function updateCandidateStatus(id: string, patch: UpdateKnowledgeCandidateStatus): Promise<KnowledgeCandidate> {
  return request<KnowledgeCandidate>(`/candidates/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function resolveCandidateRoute(id: string, action: CandidateRouteResolveAction): Promise<KnowledgeCandidate> {
  return request<KnowledgeCandidate>(`/candidates/${id}/route`, { method: 'POST', body: JSON.stringify({ action }) });
}

export function conversationIngest(input: ConversationIngestRequest): Promise<ConversationIngestResult> {
  return request<ConversationIngestResult>('/conversation-ingest?sync=1', { method: 'POST', body: JSON.stringify(input) });
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

export function organizeDocument(id: string): Promise<{ ok: true; doc: DocumentDTO; job: JobRef }> {
  return request(`/documents/${id}/organize`, { method: 'POST' });
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

function parseSseEvent(raw: string): { event: string; data: unknown } | null {
  const lines = raw.split(/\r?\n/);
  const event = lines.find((line) => line.startsWith('event: '))?.slice('event: '.length).trim();
  const data = lines
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice('data: '.length))
    .join('\n');
  if (!event || !data) return null;
  return { event, data: JSON.parse(data) as unknown };
}

export async function ask(
  question: string,
  onEvent: (event: string, data: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  const init: RequestInit = {
    method: 'POST',
    headers,
    body: JSON.stringify({ question }),
    ...(signal ? { signal } : {}),
  };
  const res = await fetch(`${BASE}/ask`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? `Request failed: ${res.status}`);
  }
  if (!res.body) throw new ApiError(500, 'Ask stream is not readable');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const frames = buffer.split(/\n\n/);
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const parsed = parseSseEvent(frame);
      if (parsed) onEvent(parsed.event, parsed.data);
    }
    if (done) break;
  }
  const parsed = parseSseEvent(buffer);
  if (parsed) onEvent(parsed.event, parsed.data);
}

export type { AskResponse };
