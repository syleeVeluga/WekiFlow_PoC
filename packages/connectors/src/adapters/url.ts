import type { SourceConnector, SourceFetchResult, SourceItem, SourceRef } from '../types.js';
import { normalizeRef } from '../types.js';

const URL_REF = 'https://example.com/wekiflow/source-policy';

export class UrlConnector implements SourceConnector {
  readonly kind = 'url' as const;
  readonly capabilities = ['list', 'fetch', 'url'] as const;

  async list(): Promise<SourceItem[]> {
    return [
      {
        kind: this.kind,
        ref: URL_REF,
        title: '웹 출처 샘플',
        summary: 'URL fetch 구조를 위한 mock 문서',
        metadata: { host: 'example.com' },
      },
    ];
  }

  async fetch(ref: SourceRef | string): Promise<SourceFetchResult> {
    const sourceRef = normalizeRef(this.kind, ref);
    // TODO: live URL fetch with allowlist, redirect checks, size limits, and content-type parsing.
    return {
      ref: sourceRef,
      text: '# 웹 출처 샘플\n\nURL 기반 출처는 allowlist와 크기 제한을 통과한 뒤 텍스트로 변환됩니다.',
      metadata: { host: 'example.com' },
      provenance: {
        kind: 'url',
        ref: sourceRef.ref,
        label: sourceRef.title ?? 'URL source',
      },
    };
  }
}

export function createUrlConnector(): UrlConnector {
  return new UrlConnector();
}
