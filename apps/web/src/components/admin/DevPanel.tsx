import { Suspense, lazy, useEffect, useState } from 'react';
import {
  canAccessDevPanel,
  userRoles,
  type RuntimeConfigPatch,
  type RuntimeConfigResponse,
} from '@wf/shared';
import type { RuntimePolicy } from '../../api/client.js';
import { usePolicy, useRuntimeConfig, useUpdatePolicy, useUpdateRuntimeConfig } from '../../api/hooks.js';
import { useAuthStore } from '../../auth/store.js';
import { useUiStore } from '../../store.js';
import { Badge } from '../common/Primitives.js';

type RuntimeConfigSection = RuntimeConfigResponse['effective'];
type PromptKey = keyof RuntimeConfigSection['prompts'];
type AgentParamKey = keyof RuntimeConfigSection['agentParams'];
type ModelKey = keyof RuntimeConfigSection['models'];
type DevTab = 'prompts' | 'params' | 'models' | 'policy';

const PROMPTS: Array<{ key: PromptKey; label: string }> = [
  { key: 'main', label: 'Main Agent' },
  { key: 'curation', label: 'Curation' },
  { key: 'merge', label: 'Merge' },
  { key: 'discoveryDecompose', label: 'Discovery Decompose' },
  { key: 'discoverySystem', label: 'Discovery System' },
  { key: 'learnerJudge', label: 'Learner Judge' },
];

const PARAMS: Array<{ key: AgentParamKey; label: string; min: number; max: number }> = [
  { key: 'mainStepLimit', label: 'Main step limit', min: 1, max: 50 },
  { key: 'discoveryStepLimit', label: 'Discovery step limit', min: 1, max: 50 },
  { key: 'curationStepLimit', label: 'Curation step limit', min: 1, max: 50 },
  { key: 'vectorK', label: 'Vector K', min: 1, max: 50 },
  { key: 'hybridK', label: 'Hybrid K', min: 1, max: 20 },
  { key: 'graphMaxDepth', label: 'Graph max depth', min: 1, max: 3 },
  { key: 'sandboxTimeoutMs', label: 'Sandbox timeout ms', min: 1000, max: 30000 },
];

const MODELS: Array<{ key: ModelKey; label: string }> = [
  { key: 'agentModel', label: 'Agent model' },
  { key: 'embeddingModel', label: 'Embedding model' },
  { key: 'tripletGoogleModel', label: 'Triplet Google model' },
  { key: 'tripletAnthropicModel', label: 'Triplet Anthropic model' },
  { key: 'tripletOpenAiFallbackModel', label: 'Triplet OpenAI fallback model' },
];

const FRESHNESS_KEYS = ['REGULATION', 'POLICY', 'METRIC', 'default'] as const;
const MonacoEditor = lazy(async () => {
  const module = await import('@monaco-editor/react');
  return { default: module.Editor };
});

interface PolicyDraft {
  sources?: { allowed_hosts?: string[] };
  enrichment?: { web_max_pages?: number };
  freshness?: Record<string, string>;
  review?: { approver_roles?: string[]; overrides?: Record<string, string[]> };
}

function clonePolicy(policy: RuntimePolicy): PolicyDraft {
  return JSON.parse(JSON.stringify(policy)) as PolicyDraft;
}

function statusBadge(active: boolean) {
  return active ? <Badge tone="warn">override</Badge> : <Badge tone="neutral">default</Badge>;
}

function PromptOverrideField({
  config,
  field,
  pending,
  onSave,
}: {
  config: RuntimeConfigResponse;
  field: (typeof PROMPTS)[number];
  pending: boolean;
  onSave: (key: PromptKey, value: string | null) => void;
}) {
  const override = config.overrides.prompts[field.key];
  const defaultValue = config.defaults.prompts[field.key] ?? '';
  const effective = config.effective.prompts[field.key] ?? '';
  const [value, setValue] = useState(override ?? effective);

  useEffect(() => setValue(override ?? effective), [override, effective]);

  return (
    <section className="card dev-prompt">
      <header>
        <div>
          <h2>{field.label}</h2>
          <small>기본 {defaultValue.length.toLocaleString()}자 · 현재 {effective.length.toLocaleString()}자</small>
        </div>
        {statusBadge(override != null)}
      </header>
      <Suspense fallback={<div className="empty">에디터를 불러오는 중입니다.</div>}>
        <MonacoEditor
          height="260px"
          language="markdown"
          value={value}
          options={{ minimap: { enabled: false }, wordWrap: 'on', scrollBeyondLastLine: false }}
          onChange={(next: string | undefined) => setValue(next ?? '')}
        />
      </Suspense>
      <div className="dev-actions">
        <button type="button" className="btn-primary" disabled={pending || !value.trim()} onClick={() => onSave(field.key, value)}>
          저장
        </button>
        <button type="button" className="btn" disabled={pending || override == null} onClick={() => onSave(field.key, null)}>
          기본값 복원
        </button>
      </div>
    </section>
  );
}

function NumberOverrideField({
  config,
  field,
  pending,
  onSave,
}: {
  config: RuntimeConfigResponse;
  field: (typeof PARAMS)[number];
  pending: boolean;
  onSave: (key: AgentParamKey, value: number | null) => void;
}) {
  const override = config.overrides.agentParams[field.key];
  const effective = config.effective.agentParams[field.key];
  const [value, setValue] = useState(override == null ? '' : String(override));

  useEffect(() => setValue(override == null ? '' : String(override)), [override]);

  const parsed = value.trim() === '' ? null : Number(value);
  const invalid = parsed != null && (!Number.isInteger(parsed) || parsed < field.min || parsed > field.max);

  return (
    <label className="dev-field">
      <span>{field.label}</span>
      <div className="dev-input-row">
        <input
          inputMode="numeric"
          value={value}
          placeholder={String(config.defaults.agentParams[field.key] ?? '')}
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="button" className="btn" disabled={pending || invalid} onClick={() => onSave(field.key, parsed)}>
          저장
        </button>
      </div>
      <small>
        현재 {effective} · 범위 {field.min}-{field.max} {statusBadge(override != null)}
      </small>
    </label>
  );
}

function ModelOverrideField({
  config,
  field,
  pending,
  onSave,
}: {
  config: RuntimeConfigResponse;
  field: (typeof MODELS)[number];
  pending: boolean;
  onSave: (key: ModelKey, value: string | null) => void;
}) {
  const override = config.overrides.models[field.key];
  const [value, setValue] = useState(override ?? '');

  useEffect(() => setValue(override ?? ''), [override]);

  return (
    <label className="dev-field">
      <span>{field.label}</span>
      <div className="dev-input-row">
        <input
          value={value}
          placeholder={config.defaults.models[field.key] ?? ''}
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="button" className="btn" disabled={pending} onClick={() => onSave(field.key, value.trim() || null)}>
          저장
        </button>
      </div>
      <small>
        현재 {config.effective.models[field.key]} {statusBadge(override != null)}
      </small>
    </label>
  );
}

function PolicyNumberField({
  label,
  value,
  defaultValue,
  pending,
  onSave,
}: {
  label: string;
  value: number;
  defaultValue: number;
  pending: boolean;
  onSave: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const parsed = Number(draft);
  const invalid = !Number.isInteger(parsed) || parsed < 1;
  return (
    <label className="dev-field">
      <span>{label}</span>
      <div className="dev-input-row">
        <input type="number" min={1} value={draft} onChange={(event) => setDraft(event.target.value)} />
        <button type="button" className="btn" disabled={pending || invalid} onClick={() => onSave(parsed)}>
          저장
        </button>
      </div>
      <small>기본값 {defaultValue}</small>
    </label>
  );
}

function PolicyTextField({
  label,
  value,
  defaultValue,
  pending,
  onSave,
}: {
  label: string;
  value: string;
  defaultValue: string;
  pending: boolean;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="dev-field">
      <span>{label}</span>
      <div className="dev-input-row">
        <input value={draft} placeholder={defaultValue} onChange={(event) => setDraft(event.target.value)} />
        <button type="button" className="btn" disabled={pending || !draft.trim()} onClick={() => onSave(draft.trim())}>
          저장
        </button>
      </div>
    </label>
  );
}

function PolicyPanel({ policy }: { policy: NonNullable<ReturnType<typeof usePolicy>['data']> }) {
  const updatePolicy = useUpdatePolicy();
  const showToast = useUiStore((s) => s.showToast);
  const [newHost, setNewHost] = useState('');

  const effective = clonePolicy(policy.effective);
  const defaults = clonePolicy(policy.defaults);
  const hosts = effective.sources?.allowed_hosts ?? [];
  const approverRoles = new Set(effective.review?.approver_roles ?? []);

  const savePolicy = async (next: PolicyDraft | null) => {
    try {
      await updatePolicy.mutateAsync(next as RuntimePolicy | null);
      showToast(next ? '정책 오버라이드를 저장했습니다.' : '정책 기본값을 복원했습니다.', 'ok');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '정책 저장에 실패했습니다.', 'warn');
    }
  };

  const withPolicy = (mutate: (next: PolicyDraft) => void) => {
    const next = clonePolicy(policy.effective);
    mutate(next);
    void savePolicy(next);
  };

  return (
    <div className="dev-policy">
      <div className="dev-policy-head">
        <div>
          <h2>정책</h2>
          <p className="muted">허용 호스트와 리뷰 정책은 신규 작업 및 승인 시점부터 적용됩니다.</p>
        </div>
        <button type="button" className="btn" disabled={updatePolicy.isPending || policy.overrides == null} onClick={() => void savePolicy(null)}>
          기본값 복원
        </button>
      </div>

      <section className="card dev-policy-card">
        <header>
          <h3>Allowed hosts</h3>
          {statusBadge(policy.overrides != null)}
        </header>
        <div className="dev-host-list">
          {hosts.length === 0 ? <span className="muted">등록된 host 없음</span> : hosts.map((host) => (
            <button
              type="button"
              className="dev-host"
              key={host}
              disabled={updatePolicy.isPending}
              onClick={() => withPolicy((next) => {
                next.sources = { ...(next.sources ?? {}), allowed_hosts: hosts.filter((item) => item !== host) };
              })}
            >
              {host} ×
            </button>
          ))}
        </div>
        <div className="dev-input-row">
          <input value={newHost} placeholder="example.com" onChange={(event) => setNewHost(event.target.value)} />
          <button
            type="button"
            className="btn"
            disabled={updatePolicy.isPending || !newHost.trim()}
            onClick={() => {
              const host = newHost.trim();
              if (!host || hosts.includes(host)) return;
              setNewHost('');
              withPolicy((next) => {
                next.sources = { ...(next.sources ?? {}), allowed_hosts: [...hosts, host] };
              });
            }}
          >
            추가
          </button>
        </div>
        <small>기본값: {(defaults.sources?.allowed_hosts ?? []).join(', ') || '없음'}</small>
      </section>

      <section className="card dev-grid-2">
        <PolicyNumberField
          label="web_max_pages"
          value={effective.enrichment?.web_max_pages ?? 1}
          defaultValue={defaults.enrichment?.web_max_pages ?? 50}
          pending={updatePolicy.isPending}
          onSave={(value) => withPolicy((next) => {
            next.enrichment = { ...(next.enrichment ?? {}), web_max_pages: value };
          })}
        />
        {FRESHNESS_KEYS.map((key) => (
          <PolicyTextField
            key={key}
            label={`freshness.${key}`}
            value={effective.freshness?.[key] ?? ''}
            defaultValue={defaults.freshness?.[key] ?? ''}
            pending={updatePolicy.isPending}
            onSave={(value) => withPolicy((next) => {
              next.freshness = { ...(next.freshness ?? {}), [key]: value };
            })}
          />
        ))}
      </section>

      <section className="card dev-policy-card">
        <header>
          <h3>Approver roles</h3>
          <span className="muted">{Array.from(approverRoles).join(', ')}</span>
        </header>
        <div className="dev-role-grid">
          {userRoles.map((role) => (
            <label className="dev-check" key={role}>
              <input
                type="checkbox"
                checked={approverRoles.has(role)}
                disabled={updatePolicy.isPending}
                onChange={(event) => withPolicy((next) => {
                  const nextRoles = new Set(approverRoles);
                  if (event.target.checked) nextRoles.add(role);
                  else nextRoles.delete(role);
                  const roles = Array.from(nextRoles);
                  next.review = {
                    ...(next.review ?? {}),
                    approver_roles: roles,
                    overrides: { ...(next.review?.overrides ?? {}), REGULATION: roles },
                  };
                })}
              />
              <span>{role}</span>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}

export function DevPanel() {
  const me = useAuthStore((s) => s.user);
  const showToast = useUiStore((s) => s.showToast);
  const config = useRuntimeConfig();
  const policy = usePolicy();
  const updateConfig = useUpdateRuntimeConfig();
  const [tab, setTab] = useState<DevTab>('prompts');

  if (!me || !canAccessDevPanel(me)) {
    return (
      <section className="pg stub">
        <h1>Access denied</h1>
        <p className="muted">Super admin permission is required.</p>
      </section>
    );
  }

  const saveConfig = async (patch: RuntimeConfigPatch, success: string) => {
    try {
      await updateConfig.mutateAsync(patch);
      showToast(success, 'ok');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '설정 저장에 실패했습니다.', 'warn');
    }
  };

  return (
    <section className="pg dev-page">
      <div className="topbar">
        <div>
          <h1>개발자 설정</h1>
          <p>프롬프트, 인자, 모델, 정책 변경은 신규 잡부터 적용되고 실행 중 잡은 변경되지 않습니다.</p>
        </div>
      </div>

      <div className="dev-tabs" role="tablist" aria-label="개발자 설정">
        {[
          ['prompts', '프롬프트'],
          ['params', '인자'],
          ['models', '모델'],
          ['policy', '정책'],
        ].map(([key, label]) => (
          <button type="button" className={tab === key ? 'on' : ''} key={key} onClick={() => setTab(key as DevTab)}>
            {label}
          </button>
        ))}
      </div>

      {config.isLoading || policy.isLoading ? <div className="empty">설정을 불러오는 중입니다.</div> : null}
      {config.error || policy.error ? <div className="empty">설정을 불러오지 못했습니다.</div> : null}

      {config.data && tab === 'prompts' ? (
        <div className="dev-prompt-grid">
          {PROMPTS.map((field) => (
            <PromptOverrideField
              config={config.data}
              field={field}
              key={field.key}
              pending={updateConfig.isPending}
              onSave={(key, value) => void saveConfig(
                { prompts: { [key]: value?.trim() ? value : null } as RuntimeConfigPatch['prompts'] },
                value == null ? '기본 프롬프트로 복원했습니다.' : '프롬프트를 저장했습니다.',
              )}
            />
          ))}
        </div>
      ) : null}

      {config.data && tab === 'params' ? (
        <div className="card dev-grid-2">
          {PARAMS.map((field) => (
            <NumberOverrideField
              config={config.data}
              field={field}
              key={field.key}
              pending={updateConfig.isPending}
              onSave={(key, value) => void saveConfig({ agentParams: { [key]: value } as RuntimeConfigPatch['agentParams'] }, '인자를 저장했습니다.')}
            />
          ))}
        </div>
      ) : null}

      {config.data && tab === 'models' ? (
        <div className="card dev-grid-2">
          {MODELS.map((field) => (
            <ModelOverrideField
              config={config.data}
              field={field}
              key={field.key}
              pending={updateConfig.isPending}
              onSave={(key, value) => void saveConfig({ models: { [key]: value } as RuntimeConfigPatch['models'] }, '모델 설정을 저장했습니다.')}
            />
          ))}
        </div>
      ) : null}

      {policy.data && tab === 'policy' ? <PolicyPanel policy={policy.data} /> : null}
    </section>
  );
}
