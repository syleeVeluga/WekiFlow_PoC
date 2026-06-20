import { useEffect, useMemo, useState, type DragEvent, type FormEvent } from 'react';
import { UNCLASSIFIED_TOPIC_NAME, type Topic } from '@wf/shared';
import { useIngest, useIngestFiles } from '../../api/hooks.js';
import { useTopics, useTopicMutations } from '../../data/hooks.js';
import { useUiStore } from '../../store.js';
import { TopicChipGrid } from '../common/TopicChipGrid.js';

const uploadAccept = '.pdf,.docx,.pptx,.xlsx,.md,.txt';
const supportedUploadExt = new Set(['.pdf', '.md', '.txt']);
const futureUploadExt = new Set(['.docx', '.pptx', '.xlsx']);
const maxFileBytes = 20 * 1024 * 1024;
const maxRequestBytes = 100 * 1024 * 1024;

type InputMode = 'file' | 'manual' | 'integration';
type CodeTab = 'javascript' | 'curl' | 'python';

function fileExt(file: File): string {
  const dot = file.name.lastIndexOf('.');
  return dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function fileIssue(file: File): string | null {
  const ext = fileExt(file);
  if (file.size > maxFileBytes) return '20 MB를 초과합니다.';
  if (futureUploadExt.has(ext)) return '추후 지원 예정입니다.';
  if (!supportedUploadExt.has(ext)) return '지원하지 않는 형식입니다.';
  return null;
}

function TopicList({
  title,
  topics,
  selectedTopic,
  onSelect,
  onDelete,
}: {
  title: string;
  topics: Topic[];
  selectedTopic?: string;
  onSelect: (topic: string) => void;
  onDelete?: (topic: Topic) => void;
}) {
  return (
    <section className="add-topic-section">
      <h3>{title}</h3>
      {topics.length ? (
        <div className="add-topic-list">
          {topics.map((topic) => (
            <button
              type="button"
              key={topic.id}
              className={`add-topic-row ${selectedTopic === topic.name ? 'on' : ''}`}
              onClick={() => onSelect(topic.name)}
            >
              <span className="add-topic-name">{topic.name}</span>
              <span className="add-topic-count">{topic.count}</span>
              {onDelete ? (
                <span
                  role="button"
                  tabIndex={0}
                  className="add-topic-delete"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(topic);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      onDelete(topic);
                    }
                  }}
                >
                  삭제
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : (
        <p className="add-topic-empty">아직 직접 추가한 주제가 없습니다.</p>
      )}
    </section>
  );
}

export function AddPage() {
  const go = useUiStore((state) => state.go);
  const showToast = useUiStore((state) => state.showToast);
  const workspaces = useUiStore((state) => state.workspaces);
  const activeWorkspaceId = useUiStore((state) => state.activeWorkspaceId);
  const { data: topics = [] } = useTopics();
  const topicMutations = useTopicMutations();
  const ingest = useIngest();
  const ingestFiles = useIngestFiles();

  const assignableTopics = useMemo(() => topics.filter((topic) => !topic.isUnclassified), [topics]);
  const userTopics = assignableTopics.filter((topic) => topic.source === 'user');
  const systemTopics = assignableTopics.filter((topic) => topic.source === 'system');

  const [selectedTopic, setSelectedTopic] = useState<string>(UNCLASSIFIED_TOPIC_NAME);
  const [newTopicName, setNewTopicName] = useState('');
  const [title, setTitle] = useState('');
  const [workspaceId, setWorkspaceId] = useState(activeWorkspaceId);
  const [mode, setMode] = useState<InputMode>('file');
  const [manualContent, setManualContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [source, setSource] = useState('');
  const [dragging, setDragging] = useState(false);
  const [codeTab, setCodeTab] = useState<CodeTab>('javascript');

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === workspaceId) ?? workspaces[0];
  const workspaceApiId = selectedWorkspace?.id ?? workspaceId;
  const totalFileBytes = files.reduce((sum, file) => sum + file.size, 0);
  const totalFileError = totalFileBytes > maxRequestBytes ? '요청당 총 업로드 용량 100 MB를 초과합니다.' : null;
  const fileRows = files.map((file) => ({ file, issue: fileIssue(file) }));
  const hasFileError = Boolean(totalFileError) || fileRows.some((row) => row.issue);
  const busy = ingest.isPending || ingestFiles.isPending;
  const submitDisabled =
    busy ||
    !selectedWorkspace ||
    (mode === 'manual'
      ? !title.trim() || !manualContent.trim()
      : mode === 'file'
        ? files.length === 0 || hasFileError
        : true);
  const mutationError = ingest.error ?? ingestFiles.error;

  const endpoint = `https://wekiflow.veluga.app/api/workspaces/${workspaceApiId}/ingestions`;
  // Only depends on the workspace id; memoized so it isn't rebuilt on every keystroke/drag render
  // (and only ever read in the integration tab).
  const codeSamples = useMemo<Record<CodeTab, string>>(
    () => ({
      javascript: `const BASE = 'https://wekiflow.veluga.app/api';\nconst API_TOKEN = 'wf_...';\n\nconst res = await fetch(\n  \`\${BASE}/workspaces/${workspaceApiId}/ingestions\`,\n  {\n    method: 'POST',\n    headers: {\n      Authorization: \`Bearer \${API_TOKEN}\`,\n      'Content-Type': 'application/json',\n    },\n    body: JSON.stringify({\n      sourceName: 'my-agent',\n      idempotencyKey: 'unique-key-for-this-doc',\n      contentType: 'text/markdown',\n      titleHint: 'Document Title',\n      metadata: { sentFrom: 'ci', repository: 'policy-repo' },\n      rawPayload: { text: '# Heading\\n\\nContent here...' },\n    }),\n  },\n);\n\nconst { documentId, jobId, replayed } = await res.json();`,
      curl: `curl -X POST '${endpoint}' \\\n  -H 'Authorization: Bearer wf_...' \\\n  -H 'Content-Type: application/json' \\\n  -d '{\n    "sourceName": "my-agent",\n    "idempotencyKey": "unique-key-for-this-doc",\n    "contentType": "text/markdown",\n    "titleHint": "Document Title",\n    "metadata": { "sentFrom": "ci" },\n    "rawPayload": { "text": "# Heading\\n\\nContent here..." }\n  }'`,
      python: `import requests\n\nbase = 'https://wekiflow.veluga.app/api'\ntoken = 'wf_...'\n\nres = requests.post(\n    f'{base}/workspaces/${workspaceApiId}/ingestions',\n    headers={'Authorization': f'Bearer {token}'},\n    json={\n        'sourceName': 'my-agent',\n        'idempotencyKey': 'unique-key-for-this-doc',\n        'contentType': 'text/markdown',\n        'titleHint': 'Document Title',\n        'metadata': {'sentFrom': 'ci'},\n        'rawPayload': {'text': '# Heading\\n\\nContent here...'},\n    },\n)\nprint(res.json())`,
    }),
    [workspaceApiId, endpoint],
  );

  useEffect(() => {
    setWorkspaceId(activeWorkspaceId);
  }, [activeWorkspaceId]);

  const resetInputs = () => {
    setTitle('');
    setManualContent('');
    setFiles([]);
    setSource('');
    setMode('file');
  };

  const createTopic = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    topicMutations.create.mutate(trimmed, {
      onSuccess: (topic) => {
        setSelectedTopic(topic.name);
        setNewTopicName('');
        showToast('주제를 추가했습니다.', 'ok');
      },
    });
  };

  const deleteTopic = (topic: Topic) => {
    topicMutations.remove.mutate(topic.id, {
      onSuccess: () => {
        if (selectedTopic === topic.name) setSelectedTopic(systemTopics[0]?.name ?? UNCLASSIFIED_TOPIC_NAME);
        showToast('주제를 삭제했습니다.', 'ok');
      },
    });
  };

  const addFiles = (list: FileList | File[]) => {
    const incoming = Array.from(list);
    if (incoming.length === 0) return;
    setFiles((current) => {
      const seen = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      const next = [...current];
      for (const file of incoming) {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (!seen.has(key)) {
          seen.add(key);
          next.push(file);
        }
      }
      return next.slice(0, 20);
    });
  };

  const removeFile = (index: number) => {
    setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  };

  const copyText = (value: string, message: string) => {
    void navigator.clipboard.writeText(value).then(
      () => showToast(message, 'ok'),
      () => showToast('복사하지 못했습니다.', 'warn'),
    );
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitDisabled || !selectedWorkspace) return;

    const sourceRef = source.trim();
    const baseMeta = {
      workspace: selectedWorkspace.name,
      ...(selectedTopic !== UNCLASSIFIED_TOPIC_NAME ? { topic: selectedTopic } : {}),
      ...(sourceRef ? { sourceLabel: sourceRef } : {}),
    };

    if (mode === 'manual') {
      ingest.mutate(
        { ...baseMeta, title: title.trim(), contentMarkdown: manualContent.trim() },
        {
          onSuccess: () => {
            resetInputs();
            showToast('검토 요청을 접수했습니다.', 'ok');
          },
        },
      );
      return;
    }

    if (mode === 'file') {
      ingestFiles.mutate(
        {
          files,
          meta: {
            ...baseMeta,
            ...(title.trim() ? { title: title.trim() } : {}),
          },
        },
        {
          onSuccess: () => {
            resetInputs();
            showToast('검토 요청을 접수했습니다.', 'ok');
          },
        },
      );
    }
  };

  return (
    <section className="add-shell">
      <aside className="add-topics">
        <header>
          <p className="eyebrow">Direct Add</p>
          <h2>주제 관리</h2>
          <p>직접 추가할 콘텐츠를 주제로 정리하고 검토 큐로 보냅니다. AI 자동 분류 주제와 별도로 관리됩니다.</p>
        </header>

        <TopicList title="직접 추가한 주제" topics={userTopics} selectedTopic={selectedTopic} onSelect={setSelectedTopic} onDelete={deleteTopic} />
        <TopicList title="기본 제공 주제" topics={systemTopics} selectedTopic={selectedTopic} onSelect={setSelectedTopic} />

        <form
          className="add-topic-create"
          onSubmit={(event) => {
            event.preventDefault();
            createTopic(newTopicName);
          }}
        >
          <input value={newTopicName} placeholder="새 주제 이름" onChange={(event) => setNewTopicName(event.target.value)} />
          <button type="submit" disabled={!newTopicName.trim() || topicMutations.create.isPending}>추가</button>
        </form>
      </aside>

      <form className="add-main" onSubmit={submit}>
        <div className="add-breadcrumb">
          <button type="button" onClick={() => go('kb')}>조직 지식</button>
          <span>/</span>
          <strong>직접 추가</strong>
        </div>

        <section className="add-card">
          <div className="add-card-head">
            <div>
              <p className="eyebrow">Optional</p>
              <h1>주제 배정</h1>
            </div>
            <span className="add-optional">선택</span>
          </div>
          <p className="add-help">검토할 콘텐츠가 들어갈 주제를 선택합니다. 선택하지 않으면 미분류로 배정되며, 나중에 페이지에서 변경할 수 있습니다.</p>
          <TopicChipGrid
            topics={topics}
            selected={selectedTopic}
            onSelect={setSelectedTopic}
            onCreate={createTopic}
            createPending={topicMutations.create.isPending}
          />
        </section>

        <section className="add-card">
          <div className="add-card-head">
            <div>
              <p className="eyebrow">Content</p>
              <h2>내용 입력</h2>
            </div>
          </div>

          <div className="add-fields">
            <label>
              <span>{mode === 'file' ? '제목' : '제목 *'}</span>
              <input value={title} placeholder="예: 법인카드 사용 기준" onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              <span>워크스페이스 *</span>
              <select value={selectedWorkspace?.id ?? ''} onChange={(event) => setWorkspaceId(event.target.value)}>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="add-mode-tabs" role="tablist" aria-label="입력 방식">
            {[
              ['file', '파일'],
              ['manual', '직접 입력'],
              ['integration', '외부 연동'],
            ].map(([key, label]) => (
              <button type="button" key={key} className={mode === key ? 'on' : ''} onClick={() => setMode(key as InputMode)}>
                {label}
              </button>
            ))}
          </div>

          {mode === 'manual' ? (
            <label className="add-manual">
              <span>내용 *</span>
              <textarea
                value={manualContent}
                placeholder="직원들이 자주 묻는 내용을 구체적으로 입력해주세요."
                onChange={(event) => setManualContent(event.target.value)}
              />
            </label>
          ) : null}

          {mode === 'file' ? (
            <>
              <label
                className={`add-dropzone ${dragging ? 'is-dragging' : ''} ${hasFileError ? 'has-error' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                <span className="add-drop-icon">⇧</span>
                <strong>여기로 파일을 끌어다 놓거나 클릭하여 선택하세요</strong>
                <small>PDF, DOCX, PPTX, XLSX, MD, TXT · 파일당 최대 20 MB · 요청당 최대 20개</small>
                <span className="add-drop-button">파일 선택</span>
                <input
                  type="file"
                  accept={uploadAccept}
                  multiple
                  onChange={(event) => {
                    if (event.target.files) addFiles(event.target.files);
                    event.currentTarget.value = '';
                  }}
                />
              </label>

              {files.length > 0 ? (
                <div className="add-file-list" aria-label="선택된 파일">
                  <div className="add-file-list-head">
                    <strong>{files.length}개 파일</strong>
                    <span>{formatBytes(totalFileBytes)} / 100 MB</span>
                  </div>
                  {fileRows.map(({ file, issue }, index) => (
                    <div className={`add-file-row ${issue ? 'has-error' : ''}`} key={`${file.name}:${file.size}:${file.lastModified}`}>
                      <div>
                        <strong>{file.name}</strong>
                        <span>{formatBytes(file.size)}{issue ? ` · ${issue}` : ''}</span>
                      </div>
                      <button type="button" onClick={() => removeFile(index)} aria-label={`${file.name} 제거`}>삭제</button>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}

          {mode === 'integration' ? (
            <div className="add-integration">
              <p className="add-help">외부 에이전트, 스크립트, CI 파이프라인에서 REST API로 이 워크스페이스에 지식을 전달합니다.</p>
              <div className="add-workspace-id">
                <span>워크스페이스 ID</span>
                <code>{workspaceApiId}</code>
                <button type="button" onClick={() => copyText(workspaceApiId, '워크스페이스 ID를 복사했습니다.')}>복사</button>
              </div>
              <div className="add-api-steps">
                <strong>1단계 - 인증</strong>
                <span>/auth/login으로 자격증명을 POST하면 JWT가 발급됩니다. 이후 모든 요청에 Authorization: Bearer &lt;token&gt; 헤더를 포함하세요.</span>
                <strong>2단계 - 지식 전달</strong>
                <span>/workspaces/{workspaceApiId}/ingestions 엔드포인트로 콘텐츠 또는 파일을 POST합니다.</span>
              </div>
              <div className="add-code-panel">
                <div className="add-code-tabs">
                  {(['javascript', 'curl', 'python'] as const).map((tab) => (
                    <button type="button" key={tab} className={codeTab === tab ? 'on' : ''} onClick={() => setCodeTab(tab)}>
                      {tab === 'javascript' ? 'JavaScript' : tab === 'curl' ? 'cURL' : 'Python'}
                    </button>
                  ))}
                  <button type="button" className="add-code-copy" onClick={() => copyText(codeSamples[codeTab], '예시 코드를 복사했습니다.')}>복사</button>
                </div>
                <pre><code>{codeSamples[codeTab]}</code></pre>
              </div>
              <div className="add-api-fields">
                {[
                  ['sourceName', '에이전트 또는 통합 이름, 필수'],
                  ['idempotencyKey', '문서당 고유 키, 재시도 중복 방지'],
                  ['contentType', 'rawPayload.text의 MIME 타입, 기본값 text/plain'],
                  ['titleHint', '문서 제목 힌트, 선택'],
                  ['metadata', 'sentFrom, repository, 처리 흐름 등 호출 출처 메타'],
                  ['rawPayload.text', '전달할 본문 텍스트, 필수'],
                ].map(([name, desc]) => (
                  <div key={name}>
                    <code>{name}</code>
                    <span>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {mode !== 'integration' ? (
            <>
              {totalFileError ? <p className="add-error">{totalFileError}</p> : null}
              <label className="add-source">
                <span>출처(선택)</span>
                <input value={source} placeholder="예: 사내 공지, 취업규칙 §22" onChange={(event) => setSource(event.target.value)} />
              </label>

              {mutationError ? (
                <p className="add-error">{mutationError.message}</p>
              ) : null}

              <div className="add-actions">
                <button type="button" className="btn" onClick={resetInputs}>취소</button>
                <button type="submit" className="btn-primary" disabled={submitDisabled}>
                  {busy ? '접수 중...' : '검토 요청하기'}
                </button>
              </div>
              <p className="add-footnote">직접 추가한 내용은 P2 배치 검토로 분류되며, 안내 박스는 이번 단계에서 반영하지 않습니다.</p>
            </>
          ) : null}
        </section>
      </form>
    </section>
  );
}
