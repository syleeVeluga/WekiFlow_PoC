# PR-28 — Enrichment Draft Agent (T2)

> Track T2 · 상태: 계획 · 선행: [PR-26](./PR-26-candidate-contract.md), [PR-27](./PR-27-candidate-model-and-trust-labels.md) · 근거: [`Overview.md`](./Overview.md) §3.1·§5.1-1·§5.1-5, [`Gap-Analysis.md`](./Gap-Analysis.md) §2.1·§2.5
> 외부 API 메모: 소스 fetch는 PR-29 Source Connector 인터페이스를 통해서만 호출(여기서는 인터페이스 소비).

## 목표

기존 Main/Ingest Agent를 제품 관점 **Enrichment Draft Agent**로 재정의한다. "기존 문서 병합"만이 아니라 **create-new / enhance-existing / skip / source-only**를 인입 단계의 1급 분기로 만들고, 결과를 PR-27 `KnowledgeCandidate`로 저장한다. `wkf regenerate`의 placeholder를 실제 에이전트와 연결한다.

## 범위

- **In:**
  - Main Agent에 `enhance/create/skip/source-only` 결정 로직 추가(Google OKF `enrichment_agent` 패턴).
  - 산출을 `KnowledgeCandidate`로 저장(상태·위험도·provenance·충돌 후보 포함).
  - 중복·충돌 탐지 → `CONFLICTED` 또는 `linkedDocId` 표시.
  - `regenerateFromRecipe`의 `runPipeline` 콜백을 실제 draft agent에 연결.
- **Out:** 대화 인입(→ PR-30), 위험도 승인 라우팅(→ PR-32), UI 인입 결과 화면 개편(본 PR은 백엔드 + 최소 결과 표시).

## 변경 파일

- 🔧 `packages/agent-tools/src/index.ts` — `MAIN_AGENT_SYSTEM_PROMPT` 개정(결정 분기 명시), `tool_decide_disposition` 추가, `tool_merge`는 enhance 분기 전용으로 유지.
- 🔧 `workers/main/src/pipeline.ts` — 파이프라인 결과를 `extractMergeResult` 대신 `extractCandidateResult`로 변경, 후보 저장 호출.
- 🆕 `packages/agent-tools/src/disposition.ts` — `decideDisposition(source, existingMatches)` → `{action:'create'|'enhance'|'skip'|'source_only', targetDocId?, riskFactors[]}`.
- 🔧 `packages/wkf/src/recipe.ts` — `regenerateFromRecipe`가 주입된 draft agent를 호출(placeholder는 fallback으로만).
- 🔧 `packages/db/src/candidateRepository.ts` — `createCandidate` 호출 연동(PR-27).

## 구현 단계

1. **결정 로직.** 인입 소스마다 hybrid 검색으로 기존 매치 조회 → `decideDisposition`: 매치 없음=create, 강한 매치=enhance, 동일/무가치=skip, 원본 보존만 필요=source_only.
2. **프롬프트 개정.** OKF `enrichment_agent`의 enhance/create/skip 기준을 시스템 프롬프트에 반영. create 4조건·비축소 원칙은 enhance에만 강제.
3. **후보 생성.** 각 결정 결과를 `KnowledgeCandidate`로 저장. 요약·핵심사실·Q&A 후보·태그·링크·출처를 채우고, riskFactors는 PR-26 규칙으로 산정.
4. **충돌 탐지.** 기존 published와 모순 가능 시 `status=CONFLICTED`, `conflictWith[]` 기록(승인 전 게시 금지).
5. **source-only.** 본문 지식화 없이 원본만 보존해야 하는 입력은 `provenance.kind` 유지 + `source_only` 후보로 저장(검색 대상 제외 플래그).
6. **recipe 연결.** `wkf regenerate`가 recipe 재실행 시 본 draft agent를 호출해 deterministic placeholder 대신 실제 후보 초안을 생성.

## 테스트

- `decideDisposition`: create/enhance/skip/source_only 4분기 단위 테스트(매치 유무·강도).
- enhance 비축소(`assertNoShrinkage`) 유지, create는 신규 후보 생성.
- 충돌 입력 → `CONFLICTED` + auto-publish 차단.
- recipe 재실행이 draft agent를 호출(placeholder fallback은 agent 미주입 시에만).

## DoD

- [ ] 인입이 create/enhance/skip/source-only 4분기를 지원한다.
- [ ] 산출이 `KnowledgeCandidate`로 저장되고 위험도/충돌이 반영된다.
- [ ] `wkf regenerate`가 실제 draft agent와 연결된다.
- [ ] 기존 병합·검증·sandbox 도구는 회귀 없이 동작한다.

## 리스크·메모

- Main Agent는 이미 광범위하게 쓰이므로 **결정 분기는 추가**하되 기존 merge/verify 경로를 깨지 않는다(점진 도입).
- BigQuery 종속 없는 범용 `Source` 모델은 PR-29에서 정의 — 본 PR은 그 인터페이스를 소비만 한다.
