import { useState } from 'react';
import { UNCLASSIFIED_TOPIC_NAME, type Topic } from '@wf/shared';

/**
 * Shared topic picker: a 미분류 chip, one chip per real (non-unclassified) topic, and an inline
 * "+ 새 주제" create input. Used by both the 직접 추가 form and the 주제 변경 modal. `selected` is the
 * currently-assigned topic name (use UNCLASSIFIED_TOPIC_NAME for 미분류). `disabled` blocks all
 * interaction while a selection is in flight.
 */
export function TopicChipGrid({
  topics,
  selected,
  onSelect,
  onCreate,
  createPending = false,
  disabled = false,
}: {
  topics: Topic[];
  selected: string;
  onSelect: (name: string) => void;
  onCreate: (name: string) => void;
  createPending?: boolean;
  disabled?: boolean;
}) {
  const [newName, setNewName] = useState('');
  const realTopics = topics.filter((topic) => !topic.isUnclassified);

  const submitNew = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setNewName('');
  };

  return (
    <div className="add-chip-grid">
      <button
        type="button"
        className={`add-chip ${selected === UNCLASSIFIED_TOPIC_NAME ? 'on' : ''}`}
        disabled={disabled}
        onClick={() => onSelect(UNCLASSIFIED_TOPIC_NAME)}
      >
        {UNCLASSIFIED_TOPIC_NAME}
      </button>
      {realTopics.map((topic) => (
        <button
          type="button"
          key={topic.id}
          className={`add-chip ${selected === topic.name ? 'on' : ''}`}
          disabled={disabled}
          onClick={() => onSelect(topic.name)}
        >
          {topic.name}
        </button>
      ))}
      <label className="add-chip add-chip-new">
        <span>+ 새 주제</span>
        <input
          value={newName}
          placeholder="입력 후 Enter"
          disabled={disabled || createPending}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submitNew();
            }
          }}
        />
      </label>
    </div>
  );
}
