import { useMemo, useState, type SyntheticEvent } from 'react';
import type { KnowledgeCandidate } from '@wf/shared';
import { useConversationIngest, usePublished, useUpdateCandidateStatus } from '../../api/hooks.js';
import { useUiStore } from '../../store.js';
import { TrustLabel } from '../common/TrustLabel.js';
import { SaveAsKnowledgeMenu, SourceNeededNote } from './SaveAsKnowledgeMenu.js';

const MEETING_REF = 'meeting://transcripts/product-sync-2026-06-20';
const SLACK_REF = 'slack://channels/c-knowledge/threads/1718899200.000000';

const SAMPLE_TRANSCRIPT = [
  'Jin: Decision: pricing answers require approval before becoming official knowledge.',
  'Mina: What is the password reset process for contractors?',
  'Alex: TODO connect the source handbook before publishing this answer.',
].join('\n');

export function ConversationPage() {
  const activeWorkspaceId = useUiStore((state) => state.activeWorkspaceId);
  const showToast = useUiStore((state) => state.showToast);
  const [transcript, setTranscript] = useState(SAMPLE_TRANSCRIPT);
  const [selectedText, setSelectedText] = useState('');
  const [candidates, setCandidates] = useState<KnowledgeCandidate[]>([]);
  const [sourceByCandidate, setSourceByCandidate] = useState<Record<string, string>>({});
  const ingest = useConversationIngest();
  const updateStatus = useUpdateCandidateStatus();
  const { data: published = [] } = usePublished();

  const transcriptLines = useMemo(() => transcript.split(/\r?\n/).filter(Boolean), [transcript]);

  const save = (input: { source: 'manual' | 'slack' | 'meeting'; transcript?: string; ref?: string }) => {
    ingest.mutate(
      { ...input, workspaceId: activeWorkspaceId },
      {
        onSuccess: (result) => {
          setCandidates(result.candidates);
          showToast(result.candidates.length > 0 ? 'Conversation candidates saved.' : 'No candidate-worthy lines found.', 'ok');
        },
        onError: (error) => showToast(error instanceof Error ? error.message : 'Conversation save failed.', 'warn'),
      },
    );
  };

  const saveSelection = () => save({ source: 'manual', transcript: selectedText.trim() || transcript });
  const updateSelection = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    const target = event.currentTarget;
    const next = target.value.slice(target.selectionStart, target.selectionEnd).trim();
    if (next) setSelectedText(next);
  };

  const markSourceChecked = (candidate: KnowledgeCandidate) => {
    const linkedDocId = sourceByCandidate[candidate.id];
    if (!linkedDocId) {
      showToast('Choose a source document first.', 'warn');
      return;
    }
    updateStatus.mutate(
      { id: candidate.id, status: 'SOURCE_VERIFIED' },
      {
        onSuccess: (updated) => {
          const sourceChecked = {
            ...updated,
            linkedDocId,
            provenance: { ...updated.provenance, needsSource: false },
          };
          setCandidates((items) => items.map((item) => (item.id === updated.id ? sourceChecked : item)));
          showToast('Candidate marked source verified.', 'ok');
        },
        onError: (error) => showToast(error instanceof Error ? error.message : 'Source update failed.', 'warn'),
      },
    );
  };

  return (
    <section className="page conversation-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Conversation ingest</p>
          <h1>Save from conversations</h1>
        </div>
        <div className="conversation-connectors">
          <button type="button" className="btn" onClick={() => save({ source: 'meeting', ref: MEETING_REF })} disabled={ingest.isPending}>
            Load meeting mock
          </button>
          <button type="button" className="btn" onClick={() => save({ source: 'slack', ref: SLACK_REF })} disabled={ingest.isPending}>
            Load Slack mock
          </button>
        </div>
      </div>

      <div className="conversation-grid">
        <section className="conversation-editor">
          <textarea
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            onMouseUp={updateSelection}
            onKeyUp={updateSelection}
            aria-label="Conversation transcript"
          />
          <SaveAsKnowledgeMenu selectedText={selectedText} isSaving={ingest.isPending} onSave={saveSelection} />
          <div className="conversation-lines">
            {transcriptLines.map((line) => (
              <button type="button" key={line} onClick={() => setSelectedText(line)}>
                {line}
              </button>
            ))}
          </div>
        </section>

        <section className="conversation-results">
          <div className="panel-title">
            <strong>Candidates</strong>
            <span>{candidates.length}</span>
          </div>
          {candidates.length === 0 ? <div className="empty">Saved conversation candidates appear here.</div> : null}
          {candidates.map((candidate) => (
            <article className="conversation-candidate" key={candidate.id}>
              <div className="candidate-topline">
                <TrustLabel status={candidate.status} riskFactors={candidate.riskFactors} />
                <SourceNeededNote candidate={candidate} />
              </div>
              <h2>{candidate.title}</h2>
              <p>{candidate.summary}</p>
              <blockquote>{candidate.provenance.conversationQuote}</blockquote>
              <div className="source-link-row">
                <select
                  value={sourceByCandidate[candidate.id] ?? ''}
                  onChange={(event) => setSourceByCandidate((next) => ({ ...next, [candidate.id]: event.target.value }))}
                  aria-label="Source document"
                >
                  <option value="">Choose source document</option>
                  {published.map((doc) => (
                    <option key={doc.id} value={doc.id}>{doc.title}</option>
                  ))}
                </select>
                <button type="button" className="btn" onClick={() => markSourceChecked(candidate)} disabled={updateStatus.isPending}>
                  Mark source checked
                </button>
              </div>
            </article>
          ))}
        </section>
      </div>
    </section>
  );
}
