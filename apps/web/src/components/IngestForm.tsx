import { useState } from 'react';
import { useIngest, useJobStream } from '../api/hooks.js';

export function IngestForm({ onIngested }: { onIngested: (docId: string) => void }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const ingest = useIngest();
  const stream = useJobStream(jobId);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    ingest.mutate(
      { title: title.trim(), contentMarkdown: content },
      {
        onSuccess: ({ doc, job }) => {
          setJobId(job.id);
          onIngested(doc.id);
          setTitle('');
          setContent('');
        },
      },
    );
  };

  return (
    <form aria-label="직접 추가" className="ingest-form" onSubmit={submit}>
      <div className="tree-title">✏️ 직접 추가</div>
      <input
        aria-label="제목"
        placeholder="문서 제목"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        aria-label="본문"
        placeholder="마크다운 본문"
        rows={4}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <button type="submit" disabled={ingest.isPending || !title.trim()}>
        {ingest.isPending ? '인입 중…' : '메인 큐로 인입'}
      </button>

      {jobId && (
        <div className="job-progress">
          <div className="progress-track">
            <div className="progress-bar" style={{ width: `${stream.progress}%` }} />
          </div>
          <span className="status">
            {stream.failed
              ? `잡 ${jobId} 실패`
              : stream.done
                ? `잡 ${jobId} 완료 → 검토 대기`
                : `잡 ${jobId} 처리 중 ${stream.progress}%`}
          </span>
        </div>
      )}
    </form>
  );
}
