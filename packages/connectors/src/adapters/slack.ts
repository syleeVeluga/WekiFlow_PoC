import type { SourceConnector, SourceFetchResult, SourceItem, SourceRef } from '../types.js';
import { normalizeRef } from '../types.js';

const THREAD_REF = 'slack://channels/c-knowledge/threads/1718899200.000000';

export class SlackConnector implements SourceConnector {
  readonly kind = 'slack' as const;
  readonly capabilities = ['list', 'fetch', 'conversation'] as const;

  async listChannels(): Promise<Array<{ id: string; name: string }>> {
    // TODO: live Slack Web API conversations.list.
    return [{ id: 'C-KNOWLEDGE', name: 'knowledge' }];
  }

  async listMessages(channelId: string): Promise<SourceItem[]> {
    // TODO: live Slack Web API conversations.history with cursor pagination.
    return (await this.list()).map((item) => ({ ...item, metadata: { ...item.metadata, channelId } }));
  }

  async fetchThread(ref: SourceRef | string): Promise<SourceFetchResult> {
    return this.fetch(ref);
  }

  async list(): Promise<SourceItem[]> {
    // TODO: live Slack Web API conversations.list/conversations.history with cursor pagination.
    return [
      {
        kind: this.kind,
        ref: THREAD_REF,
        title: '지식 승인 정책 논의',
        summary: '정책성 답변은 승인 후 공식 지식으로 게시한다는 샘플 스레드',
        metadata: { channelId: 'C-KNOWLEDGE', messageTs: '1718899200.000000' },
      },
    ];
  }

  async fetch(ref: SourceRef | string): Promise<SourceFetchResult> {
    const sourceRef = normalizeRef(this.kind, ref);
    // TODO: live Slack Web API conversations.replies, auth scopes, rate-limit retry handling.
    return {
      ref: sourceRef,
      text: [
        '이지수: 정책, 가격, 보안 답변은 승인 담당자가 확인한 뒤 공식 지식으로 올립니다.',
        '박민지: 대화에서 나온 후보는 원본 문서가 붙기 전까지 확인 필요로 둡니다.',
      ].join('\n'),
      metadata: { channelId: 'C-KNOWLEDGE', messageTs: '1718899200.000000' },
      provenance: {
        kind: 'conversation',
        ref: sourceRef.ref,
        label: sourceRef.title ?? 'Slack thread',
        speaker: '이지수',
        conversationQuote: '정책, 가격, 보안 답변은 승인 담당자가 확인한 뒤 공식 지식으로 올립니다.',
        createdFromConversation: true,
        needsSource: true,
      },
    };
  }
}

export function createSlackConnector(): SlackConnector {
  return new SlackConnector();
}
