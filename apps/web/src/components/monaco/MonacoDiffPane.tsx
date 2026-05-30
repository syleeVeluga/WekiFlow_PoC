import { DiffEditor } from '@monaco-editor/react';

export function MonacoDiffPane({ original, modified }: { original: string; modified: string }) {
  return (
    <section className="panel diff-panel" data-editor="monaco-diff" aria-label="Monaco Diff">
      <DiffEditor
        height="70vh"
        language="markdown"
        original={original}
        modified={modified}
        options={{ readOnly: true, minimap: { enabled: false }, renderSideBySide: true }}
      />
    </section>
  );
}
