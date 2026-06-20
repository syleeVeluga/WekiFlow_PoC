# plans — 남은 작업 (Remaining Work)

아직 구현하지 않은 작업. 완료되면 해당 문서를 `../archive/`로 옮긴다.

## 1. 워크스페이스 인가 (보안, Open)

- [`workspace-authorization.md`](./workspace-authorization.md) — `POST /api/workspaces/:workspaceId/ingestions`가 `workspaceId`를 검증 없이 신뢰한다. 워크스페이스 레지스트리/멤버십 모델 부재로 인한 인가 공백. 멱등성 스코프 소유자 바인딩으로 부분 완화됨, 나머지는 미해결.

## 2. OKF 선택(🟡) PR — 핵심 게이트 통과 후 착수

핵심 PR(01~18)은 구현 완료(`../archive/okf-knowledge-standard/implementation/`). 아래 두 건은 **선택(opt-in)** 으로 미구현이다.

- [`okf-pr-19-external-enrichment.md`](./okf-pr-19-external-enrichment.md) — 파이프라인 C에 외부 allowlist 크롤 enrichment 추가(`policy.yaml`의 `allowed_hosts`·`web_max_pages` 하드 강제). 선행: PR-11.
- [`okf-pr-20-mcp-and-connectors.md`](./okf-pr-20-mcp-and-connectors.md) — `wkf mcp`로 번들을 MCP 서버로 노출 + 멀티소스 커넥터 일반화. 선행: PR-05.

> 설계 근거는 [`../reference/okf-knowledge-standard/`](../reference/okf-knowledge-standard/), 조사·통합계획은 [`../archive/okf-knowledge-standard/`](../archive/okf-knowledge-standard/).
