import type { SourceConnector, SourceFetchResult, SourceItem, SourceRef } from '../types.js';
import { normalizeRef } from '../types.js';

const UPLOAD_REF = 'upload://samples/handbook.md';

export class UploadConnector implements SourceConnector {
  readonly kind = 'upload' as const;
  readonly capabilities = ['list', 'fetch', 'file'] as const;

  async list(): Promise<SourceItem[]> {
    return [
      {
        kind: this.kind,
        ref: UPLOAD_REF,
        title: '업로드 샘플 문서',
        summary: '기존 파일 업로드 인입을 SourceConnector로 감싼 샘플',
        metadata: { contentType: 'text/markdown' },
      },
    ];
  }

  async fetch(ref: SourceRef | string): Promise<SourceFetchResult> {
    const sourceRef = normalizeRef(this.kind, ref);
    return {
      ref: sourceRef,
      text: '# 업로드 샘플\n\n파일 업로드도 동일한 SourceConnector fetch 결과로 변환됩니다.',
      metadata: { contentType: 'text/markdown' },
      provenance: {
        kind: 'file',
        ref: sourceRef.ref,
        label: sourceRef.title ?? 'Uploaded file',
      },
    };
  }
}

export function createUploadConnector(): UploadConnector {
  return new UploadConnector();
}
