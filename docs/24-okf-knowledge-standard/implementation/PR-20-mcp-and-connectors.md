# PR-20 — (선택) `wkf mcp` + 멀티소스 커넥터

> Phase 7 · 선택(🟡) · 선행: PR-05 · 근거: [`09` §A.2·§B.4](../09-enrichment-harness-and-mdcode.md), [`06` §5](../06-adoptable-patterns.md)

## 목표
WKF 번들을 MCP 서버로 노출해 외부 에이전트/IDE가 표준 프로토콜로 조직 지식을 읽고(우선) 제안하게 한다. 인입 소스를 커넥터로 일반화.

## 범위
- **In:** `wkf mcp`(번들 list/lookup MCP 도구, 읽기 우선), 멀티소스 커넥터 인터페이스(upload/datasource/manual + confluence/gdrive/github 스텁).
- **Out:** 쓰기 자동화(검토 게이트 뒤).

## 변경 파일
- 🆕 `packages/wkf/src/mcp.ts`
- 🆕 `packages/agent-tools/src/connectors/`(인터페이스 + 스텁)

## 구현 단계
1. `wkf mcp`: MCP 서버로 `list_concepts`/`lookup_concept`(읽기), `propose_change`(검토 큐로만, 직접 쓰기 금지) 노출.
2. 커넥터 인터페이스 `Source { list(); fetch(ref): text }` — 기존 3종 + 외부 3종 스텁([`09` §A.2]).
3. 인증/권한: 읽기는 토큰, 쓰기 제안은 검토 게이트 경유.

## 테스트
- MCP 서버가 list/lookup 응답.
- `propose_change`가 직접 쓰지 않고 검토 큐로.
- 커넥터 인터페이스 계약 테스트.

## DoD
- [ ] 외부 에이전트/IDE가 `wkf mcp`로 지식을 읽는다.
- [ ] 쓰기는 검토 게이트를 우회하지 못한다.

## 리스크·메모
- 보안: 읽기 노출 범위를 `policy.yaml` publishing 범위로 제한.
- 선택 PR — 생태계 연동 단계. 커넥터는 점진 구현.
