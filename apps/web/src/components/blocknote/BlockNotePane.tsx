import { useEffect } from 'react';
import type { ComponentType } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';

const RuntimeBlockNoteView = BlockNoteView as unknown as ComponentType<Record<string, unknown>>;

export function BlockNotePane({ markdown, editable }: { markdown: string; editable: boolean }) {
  const editor = useCreateBlockNote();

  useEffect(() => {
    const blocks = editor.tryParseMarkdownToBlocks(markdown);
    editor.replaceBlocks(
      editor.document.map((block) => block.id),
      blocks,
    );
  }, [editor, markdown]);

  return (
    <section className="panel" data-editor="blocknote" aria-label="BlockNote editor">
      <div className="panel-meta">{editable ? 'editable' : 'read-only'}</div>
      <RuntimeBlockNoteView editor={editor} editable={editable} theme="light" />
    </section>
  );
}
