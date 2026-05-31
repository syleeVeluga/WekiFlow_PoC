import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { DepartmentSchema, UNCLASSIFIED_DEPARTMENT, type Department, type Topic } from '@wf/shared';
import { useIngest, useIngestFile } from '../../api/hooks.js';
import { useTopics, useTopicMutations } from '../../data/hooks.js';
import { useUiStore } from '../../store.js';

const departments = DepartmentSchema.options.filter((department): department is Department => department !== UNCLASSIFIED_DEPARTMENT);
const uploadAccept = '.pdf,.docx,.pptx,.xlsx,.md,.txt';
const supportedUploadExt = new Set(['.pdf', '.md', '.txt']);
const futureUploadExt = new Set(['.docx', '.pptx', '.xlsx']);

type InputMode = 'file' | 'webpage' | 'manual' | 'integration';

function fileExt(file: File): string {
  const dot = file.name.lastIndexOf('.');
  return dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
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
  const { data: topics = [] } = useTopics();
  const topicMutations = useTopicMutations();
  const ingest = useIngest();
  const ingestFile = useIngestFile();

  const assignableTopics = useMemo(() => topics.filter((topic) => !topic.isUnclassified), [topics]);
  const userTopics = assignableTopics.filter((topic) => topic.source === 'user');
  const systemTopics = assignableTopics.filter((topic) => topic.source === 'system');

  const [selectedTopic, setSelectedTopic] = useState('');
  const [newTopicName, setNewTopicName] = useState('');
  const [quickTopicName, setQuickTopicName] = useState('');
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState<Department>(departments[0]!);
  const [mode, setMode] = useState<InputMode>('file');
  const [manualContent, setManualContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState('');

  useEffect(() => {
    if (!selectedTopic && assignableTopics[0]) setSelectedTopic(assignableTopics[0].name);
  }, [assignableTopics, selectedTopic]);

  const fileError = file && futureUploadExt.has(fileExt(file)) ? 'DOCX/PPTX/XLSX 파일 추출은 추후 지원 예정입니다.' : null;
  const unsupportedFile = file && !supportedUploadExt.has(fileExt(file)) && !futureUploadExt.has(fileExt(file));
  const submitDisabled =
    ingest.isPending ||
    ingestFile.isPending ||
    !selectedTopic ||
    !title.trim() ||
    !department ||
    (mode === 'manual' ? !manualContent.trim() : mode === 'file' ? !file || Boolean(fileError) || Boolean(unsupportedFile) : true);
  const mutationError = ingest.error ?? ingestFile.error;

  const resetInputs = () => {
    setTitle('');
    setManualContent('');
    setFile(null);
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
        setQuickTopicName('');
        showToast('주제를 추가했습니다.', 'ok');
      },
    });
  };

  const deleteTopic = (topic: Topic) => {
    topicMutations.remove.mutate(topic.id, {
      onSuccess: () => {
        if (selectedTopic === topic.name) setSelectedTopic(systemTopics[0]?.name ?? '');
        showToast('주제를 삭제했습니다.', 'ok');
      },
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitDisabled) return;

    const sourceRef = source.trim() || file?.name;
    const meta = {
      title: title.trim(),
      topic: selectedTopic,
      department,
      ...(sourceRef ? { sourceLabel: sourceRef } : {}),
    };

    if (mode === 'manual') {
      ingest.mutate(
        { ...meta, contentMarkdown: manualContent.trim() },
        {
          onSuccess: () => {
            resetInputs();
            showToast('검토 요청을 접수했습니다.', 'ok');
          },
        },
      );
      return;
    }

    if (mode === 'file' && file) {
      ingestFile.mutate(
        { file, meta },
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
              <p className="eyebrow">Required</p>
              <h1>주제 배정</h1>
            </div>
            <span className="add-required">필수</span>
          </div>
          <p className="add-help">검토할 콘텐츠가 들어갈 주제를 하나 선택합니다. 새 주제는 생성 후 자동 선택됩니다.</p>
          <div className="add-chip-grid">
            {assignableTopics.map((topic) => (
              <button
                type="button"
                key={topic.id}
                className={`add-chip ${selectedTopic === topic.name ? 'on' : ''}`}
                onClick={() => setSelectedTopic(topic.name)}
              >
                {topic.name}
              </button>
            ))}
            <label className="add-chip add-chip-new">
              <span>+ 새 주제</span>
              <input
                value={quickTopicName}
                placeholder="입력 후 Enter"
                onChange={(event) => setQuickTopicName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    createTopic(quickTopicName);
                  }
                }}
              />
            </label>
          </div>
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
              <span>제목 *</span>
              <input value={title} placeholder="예: 법인카드 사용 기준" onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              <span>부서 *</span>
              <select value={department} onChange={(event) => setDepartment(event.target.value as Department)}>
                {departments.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="add-mode-tabs" role="tablist" aria-label="입력 방식">
            {[
              ['file', '파일'],
              ['webpage', '웹페이지'],
              ['manual', '직접 입력'],
              ['integration', '연동'],
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
            <label className={`agent-drop add-drop ${fileError || unsupportedFile ? 'has-error' : ''}`}>
              <span>{file ? file.name : '파일을 선택하거나 드래그해 업로드하세요.'}</span>
              <small>PDF, DOCX, PPTX, XLSX, MD, TXT · 최대 20 MB</small>
              <input
                type="file"
                accept={uploadAccept}
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] ?? null;
                  setFile(nextFile);
                  if (nextFile && futureUploadExt.has(fileExt(nextFile))) showToast('DOCX/PPTX/XLSX 파일은 추후 지원 예정입니다.', 'warn');
                  if (nextFile && !supportedUploadExt.has(fileExt(nextFile)) && !futureUploadExt.has(fileExt(nextFile))) {
                    showToast('지원하지 않는 파일 형식입니다.', 'warn');
                  }
                }}
              />
            </label>
          ) : null}

          {mode === 'webpage' || mode === 'integration' ? (
            <div className="add-disabled-panel">
              <strong>준비 중</strong>
              <span>이번 단계에서는 직접 입력과 파일 업로드만 검토 요청으로 연결됩니다.</span>
            </div>
          ) : null}

          {fileError ? <p className="add-error">{fileError}</p> : null}
          {unsupportedFile ? <p className="add-error">지원하지 않는 파일 형식입니다.</p> : null}

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
              {ingest.isPending || ingestFile.isPending ? '접수 중...' : '검토 요청하기'}
            </button>
          </div>
          <p className="add-footnote">직접 추가한 내용은 P2 배치 검토로 분류되며, 안내 박스는 이번 단계에서 반영하지 않습니다.</p>
        </section>
      </form>
    </section>
  );
}
