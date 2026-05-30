import { useCallback, useEffect, useRef } from 'react';
import type { ComponentType } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';

const RuntimeBlockNoteView = BlockNoteView as unknown as ComponentType<Record<string, unknown>>;

export function BlockNotePane({
  markdown,
  editable,
  onMarkdownChange,
}: {
  markdown: string;
  editable: boolean;
  onMarkdownChange?: (markdown: string) => void;
}) {
  const editor = useCreateBlockNote();
  const applyingMarkdown = useRef(false);

  useEffect(() => {
    applyingMarkdown.current = true;
    const blocks = editor.tryParseMarkdownToBlocks(markdown);
    try {
      editor.replaceBlocks(
        editor.document.map((block) => block.id),
        blocks,
      );
    } finally {
      applyingMarkdown.current = false;
    }
  }, [editor, markdown]);

  const handleChange = useCallback(() => {
    if (applyingMarkdown.current) return;
    onMarkdownChange?.(editor.blocksToMarkdownLossy(editor.document));
  }, [editor, onMarkdownChange]);

  return (
    <section className="panel" data-editor="blocknote" aria-label="BlockNote editor">
      <div className="panel-meta">{editable ? 'editable' : 'read-only'}</div>
      <RuntimeBlockNoteView editor={editor} editable={editable} onChange={handleChange} theme="light" />
    </section>
  );
}
