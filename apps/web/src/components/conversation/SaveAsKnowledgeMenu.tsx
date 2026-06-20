import type { KnowledgeCandidate } from '@wf/shared';

export function SaveAsKnowledgeMenu({
  selectedText,
  isSaving,
  onSave,
}: {
  selectedText: string;
  isSaving: boolean;
  onSave: () => void;
}) {
  return (
    <div className="conversation-savebar">
      <div>
        <strong>Save selected text</strong>
        <small>{selectedText ? `${selectedText.length} characters selected` : 'Select transcript text or use the full transcript.'}</small>
      </div>
      <button type="button" className="btn-primary" disabled={isSaving} onClick={onSave}>
        {isSaving ? 'Saving...' : 'Save as candidate'}
      </button>
    </div>
  );
}

export function SourceNeededNote({ candidate }: { candidate: KnowledgeCandidate }) {
  return candidate.provenance.needsSource ? <span className="source-needed">Source needed</span> : null;
}
