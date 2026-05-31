import { lazy, Suspense, useMemo, useState, type FormEvent } from 'react';
import type { AgentPreviewResult, AgentStepDTO, Triplet } from '@wf/shared';
import { canManageOwners } from '@wf/shared';
import { ApiError } from '../../api/client.js';
import {
  useAgentPreview,
  useAgentPreviewMessage,
  useAgentPreviews,
  useAgentPreviewUpload,
  useAgentRunStream,
} from '../../api/hooks.js';
import { useAuthStore } from '../../auth/store.js';
import { useUiStore } from '../../store.js';
import { Badge, Certainty } from '../common/Primitives.js';

const MonacoDiffPane = lazy(async () => {
  const module = await import('../monaco/MonacoDiffPane.js');
  return { default: module.MonacoDiffPane };
});

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value != null ? (value as Record<string, unknown>) : {};
}

function short(value: unknown, max = 96): string {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function summarizeArgs(step: AgentStepDTO): string {
  const args = asRecord(step.args);
  if (typeof args.query === 'string') return `query: ${short(args.query)}`;
  if (typeof args.code === 'string') return short(args.code);
  if (typeof args.chunkIndex === 'number') return `chunk ${args.chunkIndex}`;
  if (typeof args.factCount === 'number') return `${args.factCount} facts`;
  if (typeof args.documentId === 'string') return `doc ${short(args.documentId, 28)}`;
  return short(args);
}

function summarizeResult(step: AgentStepDTO): string {
  const result = asRecord(step.result);
  if (typeof result.changeSummary === 'string') return result.changeSummary;
  if (typeof result.tripletCount === 'number') return `${result.tripletCount} triplets`;
  if (typeof result.count === 'number') return `${result.count} hits`;
  if (typeof result.allVerified === 'boolean') return result.allVerified ? 'verified' : 'needs review';
  if (typeof result.exitCode === 'number') return `exit ${result.exitCode}`;
  return short(result, 120);
}

function stepGroup(step: AgentStepDTO): 'search' | 'merge' | 'graph' {
  if (step.phase === 'graph' || step.tool.includes('triplet')) return 'graph';
  if (step.tool.includes('merge')) return 'merge';
  return 'search';
}

function StepTimeline({ steps, active, failed }: { steps: AgentStepDTO[]; active: boolean; failed: boolean }) {
  const groups = [
    { key: 'search', title: '1. Search and verify' },
    { key: 'merge', title: '2. Merge draft' },
    { key: 'graph', title: '3. Extract triplets' },
  ] as const;

  return (
    <div className="agent-timeline">
      {groups.map((group) => {
        const groupSteps = steps.filter((step) => stepGroup(step) === group.key);
        return (
          <section className="agent-step-group" key={group.key}>
            <header>
              <h3>{group.title}</h3>
              <Badge tone={groupSteps.length > 0 ? 'ok' : active ? 'info' : failed ? 'error' : 'neutral'}>
                {groupSteps.length}
              </Badge>
            </header>
            {groupSteps.length === 0 ? (
              <div className="agent-step-empty">{active ? 'waiting' : 'no steps'}</div>
            ) : (
              groupSteps.map((step, index) => (
                <article className="agent-step" key={`${step.tool}-${index}`}>
                  <div className="agent-step-head">
                    <Badge tone={step.phase === 'graph' ? 'warn' : 'info'}>{step.tool}</Badge>
                    {step.tookMs != null ? <span>{step.tookMs}ms</span> : null}
                  </div>
                  <p>{summarizeArgs(step)}</p>
                  <small>{summarizeResult(step)}</small>
                </article>
              ))
            )}
          </section>
        );
      })}
      {active ? <div className="agent-spinner" aria-label="Preview running" /> : null}
    </div>
  );
}

function TripletTable({ triplets }: { triplets: Triplet[] }) {
  if (triplets.length === 0) return <div className="empty">No triplets extracted.</div>;
  return (
    <table className="agent-triplets">
      <thead>
        <tr>
          <th>Subject</th>
          <th>Predicate</th>
          <th>Object</th>
          <th>Type</th>
          <th>Strength</th>
        </tr>
      </thead>
      <tbody>
        {triplets.map((triplet, index) => (
          <tr key={`${triplet.subject}-${triplet.predicate}-${triplet.object}-${index}`}>
            <td>{triplet.subject}</td>
            <td>{triplet.predicate}</td>
            <td>{triplet.object}</td>
            <td>
              <Badge>{triplet.subjectType}</Badge> <Badge>{triplet.objectType}</Badge>
            </td>
            <td>
              <Certainty value={triplet.strength} /> {Math.round(triplet.strength * 100)}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ResultPanel({ original, result }: { original: string; result: AgentPreviewResult | null }) {
  if (!result) return <div className="empty">No result</div>;
  return (
    <div className="agent-result">
      <section>
        <div className="agent-result-head">
          <h3>Draft diff</h3>
          <Badge tone={result.merged ? 'ok' : 'warn'}>{result.merged ? 'merged' : 'fallback'}</Badge>
        </div>
        <Suspense fallback={<div className="panel">Diff loading</div>}>
          <MonacoDiffPane original={original} modified={result.draftMarkdown} />
        </Suspense>
      </section>
      <section>
        <div className="agent-result-head">
          <h3>Triplets</h3>
          <Badge tone="info">{result.tripletCount}</Badge>
        </div>
        <TripletTable triplets={result.triplets} />
      </section>
    </div>
  );
}

export function AgentPreviewPage() {
  const me = useAuthStore((s) => s.user);
  const showToast = useUiStore((s) => s.showToast);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const messageMutation = useAgentPreviewMessage();
  const uploadMutation = useAgentPreviewUpload();
  const { data: recent = [] } = useAgentPreviews();
  const replay = useAgentPreview(jobId);
  const stream = useAgentRunStream(jobId);

  const steps = stream.steps.length > 0 ? stream.steps : replay.data?.steps ?? [];
  const result = stream.result ?? replay.data?.result ?? null;
  const running = Boolean(jobId && !stream.done && !stream.failed && !replay.data?.result);
  // The diff base comes from the result the server actually merged against (real extracted text,
  // including PDFs), so it's correct for live, replayed, and reloaded runs alike.
  const original = result?.originalMarkdown ?? '';
  const busy = messageMutation.isPending || uploadMutation.isPending;

  const stats = useMemo(() => {
    const main = steps.filter((step) => step.phase !== 'graph').length;
    const graph = steps.filter((step) => step.phase === 'graph').length;
    return { main, graph };
  }, [steps]);

  if (!me || !canManageOwners(me.role)) {
    return (
      <section className="pg stub">
        <h1>Access denied</h1>
        <p className="muted">Owner permission is required.</p>
      </section>
    );
  }

  const toastErr = (err: unknown) => showToast(err instanceof ApiError ? err.message : 'Preview failed.', 'warn');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      if (file) {
        const started = await uploadMutation.mutateAsync({ file, ...(title.trim() ? { title: title.trim() } : {}) });
        setJobId(started.jobId);
        return;
      }
      const content = message.trim();
      if (!content) {
        showToast('Preview input is empty.', 'warn');
        return;
      }
      const started = await messageMutation.mutateAsync({
        message: content,
        ...(title.trim() ? { title: title.trim() } : {}),
      });
      setJobId(started.jobId);
    } catch (error) {
      toastErr(error);
    }
  };

  return (
    <section className="pg agent-page">
      <div className="topbar">
        <div>
          <h1>에이전트 미리보기</h1>
          <p>{recent.length} recent runs</p>
        </div>
        <div className="row">
          <Badge tone="info">{stats.main} main</Badge>
          <Badge tone="warn">{stats.graph} graph</Badge>
        </div>
      </div>

      <div className="agent-layout">
        <aside className="agent-left">
          <form className="card agent-input" onSubmit={submit}>
            <label>
              <span>Title</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Preview title" />
            </label>
            <label
              className="agent-drop"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                setFile(event.dataTransfer.files?.[0] ?? null);
              }}
            >
              <span>{file ? file.name : 'md, txt, pdf'}</span>
              <input
                type="file"
                accept=".md,.txt,.pdf"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <label>
              <span>Message</span>
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={8} />
            </label>
            <button className="btn-primary" type="submit" disabled={busy}>
              {busy ? 'Starting...' : 'Run preview'}
            </button>
          </form>

          <section className="card agent-history">
            <h3>Recent runs</h3>
            {recent.length === 0 ? (
              <div className="agent-step-empty">No runs</div>
            ) : (
              recent.slice(0, 30).map((run) => (
                <button
                  type="button"
                  className={run.jobId === jobId ? 'on' : ''}
                  key={run.jobId}
                  onClick={() => setJobId(run.jobId)}
                >
                  <span>{run.title ?? run.jobId}</span>
                  <Badge tone={run.status === 'completed' ? 'ok' : run.status === 'failed' ? 'error' : 'info'}>
                    {run.status}
                  </Badge>
                </button>
              ))
            )}
          </section>
        </aside>

        <main className="agent-main">
          <section className="card agent-progress">
            <div className="agent-progress-head">
              <h2>{jobId ?? 'No active preview'}</h2>
              <Badge tone={stream.failed ? 'error' : stream.done ? 'ok' : running ? 'info' : 'neutral'}>
                {stream.failed ? 'failed' : stream.done ? 'completed' : running ? 'running' : 'idle'}
              </Badge>
            </div>
            <div className="progress-track">
              <div className="progress-bar" style={{ width: `${stream.progress}%` }} />
            </div>
            {stream.error ? <p className="agent-error">{stream.error}</p> : null}
          </section>

          <StepTimeline steps={steps} active={running} failed={stream.failed} />
          <ResultPanel original={original} result={result} />
        </main>
      </div>
    </section>
  );
}
