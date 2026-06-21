# Source to Official Knowledge Flow

This document is the product contract for documents that enter WekiFlow as stored source material before they become official knowledge.

## User-Facing Flow

The primary flow is:

1. A user adds a file or manual source.
2. WekiFlow keeps the raw source visible under `인입 원본`.
3. If the source has not yet been promoted, the document is shown as `지식화 안 됨`.
4. The user opens the source document and selects `AI로 지식화`.
5. With `reviewApprovalEnabled=false`, WekiFlow promotes the document immediately:
   - document status becomes `PUBLISHED`;
   - a wiki knowledge item is materialized;
   - the knowledge item receives the `AI 정리됨` trust tag;
   - the detail page shows `지식화 완료`;
   - the item appears in home digest, organization knowledge, and the knowledge map.
6. With `reviewApprovalEnabled=true`, this direct promotion path is blocked. The user must use the review flow.

This is intentionally different from hiding unprocessed source documents. A user should always be able to see whether a source is only stored or has been promoted into reusable organizational knowledge.

## UI Terms

Use these labels consistently:

| State | User label | Meaning |
| --- | --- | --- |
| `DRAFT` source-only document | `지식화 안 됨` | The raw source is stored, but it is not used by home, organization knowledge, map, or answers as official knowledge. |
| `PROCESSING` | `AI 처리 중` | WekiFlow is reading or analyzing the source. |
| `REVIEW` | `확인 필요` | A draft exists, but policy or settings require confirmation before official use. |
| `PUBLISHED` or `GRAPH_INDEXED` without AI tag | `공식 지식` | The document is official reusable knowledge. |
| `PUBLISHED` or `GRAPH_INDEXED` with `AI 정리됨` | `지식화 완료` | The source was promoted through the knowledge-organizing action and is now official reusable knowledge. |
| `FAILED` | `처리 실패` | The source could not be processed and needs retry or manual handling. |

`공식 지식` remains the tree/list section name for reusable knowledge. `지식화 완료` is a trust/status badge for a promoted source item, not a separate storage class.

## Backend Contract

The source promotion API is:

```http
POST /api/documents/:id/organize
```

Required behavior:

- Requires an authenticated user with edit permission.
- Requires `reviewApprovalEnabled=false`.
- Accepts only source-only `DRAFT` documents.
- Publishes the document through the same materialization path as approval, so the wiki item, home digest, organization knowledge, and knowledge map are updated from the same source of truth.
- Enqueues graph extraction for the promoted document.
- Adds `AI 정리됨` to the materialized knowledge item.

The endpoint must not become an approval bypass. If approval is enabled, or if policy later decides the source is high-risk, the document must go through review instead.

## Development Rules

- Do not show internal terms such as WKF, Pipeline A/B/C/D, `source_only`, or `DRAFT` in normal user-facing labels.
- Do not remove `인입 원본`; it is the only visible place where stored-but-not-official source material is discoverable.
- Do not treat `지식화 안 됨` as an error. It is a valid holding state.
- Do not let a promoted source disappear after `AI로 지식화`; it must move into official knowledge surfaces.
- Keep tests for the full flow: empty home, source-only draft visible, `AI로 지식화`, `지식화 완료`, and official knowledge surfaces updated.

## Current Implementation Notes

The current PoC promotion path materializes the stored source content as official knowledge and records the `AI 정리됨` trust tag. A future enrichment-worker implementation may add a stronger LLM regeneration step before publication, but it must preserve the user-facing flow and backend guardrails above.
