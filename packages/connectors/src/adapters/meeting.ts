import type { SourceConnector, SourceFetchResult, SourceItem, SourceRef } from '../types.js';
import { normalizeRef } from '../types.js';

const TRANSCRIPT_REF = 'meeting://transcripts/product-sync-2026-06-20';

export interface MeetingTranscriptSegment {
  speaker: string;
  quote: string;
  offsetSeconds: number;
}

const transcript: MeetingTranscriptSegment[] = [
  { speaker: '이지수', quote: '대화 기반 후보는 확인 필요 상태로 보관합니다.', offsetSeconds: 42 },
  { speaker: '김도윤', quote: '원본 문서가 연결되면 출처 확인됨으로 승격할 수 있습니다.', offsetSeconds: 85 },
];

export function parseTranscriptSegments(text: string): MeetingTranscriptSegment[] {
  return text
    .split(/\r?\n/)
    .map((line, index) => {
      const [speaker, ...quoteParts] = line.split(':');
      return {
        speaker: speaker?.trim() || 'Unknown',
        quote: quoteParts.join(':').trim(),
        offsetSeconds: index * 30,
      };
    })
    .filter((segment) => segment.quote.length > 0);
}

export class MeetingConnector implements SourceConnector {
  readonly kind = 'meeting' as const;
  readonly capabilities = ['list', 'fetch', 'conversation'] as const;

  async list(): Promise<SourceItem[]> {
    return [
      {
        kind: this.kind,
        ref: TRANSCRIPT_REF,
        title: '제품 싱크 회의록',
        summary: '대화 기반 후보 provenance 샘플 회의록',
        metadata: { segmentCount: transcript.length },
      },
    ];
  }

  parseTranscript(text: string): MeetingTranscriptSegment[] {
    return parseTranscriptSegments(text);
  }

  async fetch(ref: SourceRef | string): Promise<SourceFetchResult> {
    const sourceRef = normalizeRef(this.kind, ref);
    return {
      ref: sourceRef,
      text: transcript.map((segment) => `${segment.speaker}: ${segment.quote}`).join('\n'),
      metadata: { transcript },
      provenance: {
        kind: 'conversation',
        ref: sourceRef.ref,
        label: sourceRef.title ?? 'Meeting transcript',
        speaker: transcript[0]!.speaker,
        conversationQuote: transcript[0]!.quote,
        createdFromConversation: true,
        needsSource: true,
      },
    };
  }
}

export function createMeetingConnector(): MeetingConnector {
  return new MeetingConnector();
}
