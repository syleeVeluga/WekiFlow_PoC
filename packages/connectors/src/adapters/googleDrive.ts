import type { SourceConnector, SourceFetchResult, SourceItem, SourceRef } from '../types.js';
import { normalizeRef } from '../types.js';

const FILE_REF = 'gdrive://files/policy-handbook';

export class GoogleDriveConnector implements SourceConnector {
  readonly kind = 'google_drive' as const;
  readonly capabilities = ['list', 'fetch', 'file'] as const;

  async listFiles(): Promise<SourceItem[]> {
    return this.list();
  }

  async fetchFile(ref: SourceRef | string): Promise<SourceFetchResult> {
    return this.fetch(ref);
  }

  async list(): Promise<SourceItem[]> {
    // TODO: live Google Drive files.list with OAuth token refresh and MIME export handling.
    return [
      {
        kind: this.kind,
        ref: FILE_REF,
        title: '정책 핸드북',
        summary: '승인 정책과 출처 확인 규칙이 담긴 샘플 Drive 문서',
        metadata: { mimeType: 'application/vnd.google-apps.document' },
      },
    ];
  }

  async fetch(ref: SourceRef | string): Promise<SourceFetchResult> {
    const sourceRef = normalizeRef(this.kind, ref);
    // TODO: live Google Drive files.export/files.get_media.
    return {
      ref: sourceRef,
      text: '# 정책 핸드북\n\n정책성, 규정, 계약, 보안, 가격, 공식 답변 후보는 승인 대상입니다.',
      metadata: { mimeType: 'text/markdown' },
      provenance: {
        kind: 'datasource',
        ref: sourceRef.ref,
        label: sourceRef.title ?? 'Google Drive file',
        needsSource: false,
      },
    };
  }
}

export function createGoogleDriveConnector(): GoogleDriveConnector {
  return new GoogleDriveConnector();
}
