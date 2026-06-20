# PR-26 — Candidate Contract & 상태기계 (GA-02 기반)

> Track T1(선행) · 상태: 계획 · 선행: 없음(전체 트랙의 루트) · 근거: [`Overview.md`](./Overview.md) §2.2·§6 GA-02, [`Gap-Analysis.md`](./Gap-Analysis.md) §4.1
> 외부 API 메모: 본 PR은 순수 contract/스키마이며 외부 연결 없음.

## 목표

상세 구현 PR들의 **공통 선행 계약**을 확정한다. `KnowledgeCandidate` 상태 기계, 위험도 기반 `needsReview` 규칙, 대화 기반 provenance 규칙, 자동 게시 가능 조건을 코드 스키마와 문서로 못 박는다. 이 PR 없이는 T1~T6가 서로 다른 상태 정의를 갖게 된다.

## 범위

- **In:**
  - 사용자-facing 지식화 상태 enum 정의(`AI 정리됨 / 출처 확인됨 / 확인 필요 / 승인 필요 / 공식 지식 / 충돌 있음`).
  - 현행 내부 `documentStatuses`(DRAFT/PROCESSING/PREVIEW/REVIEW/PUBLISHED/GRAPH_INDEXED/FAILED) ↔ 후보 상태 매핑표.
  - 위험도 차원(riskFactors) 정의 및 `needsReview` 산정 규칙.
  - provenance 타입 확장 정의(파일/URL/대화 발화 구분).
  - 자동 게시(auto-publish) 허용 조건.
- **Out:** 실제 저장 모델 마이그레이션·API(→ PR-27), UI(→ PR-27/32), 에이전트 연결(→ PR-28).

## 변경 파일

- 🆕 `packages/shared/src/candidate.ts` — `CandidateStatusSchema`, `RiskFactorSchema`, `CandidateProvenanceSchema`, `needsReview()` 순수 함수, `canAutoPublish()` 순수 함수.
- 🔧 `packages/shared/src/index.ts` — re-export 및 `documentStatuses` ↔ candidate status 매핑 상수(`CANDIDATE_TO_DOC_STATUS`).
- 🆕 `docs/plans/okf-enrichment-product-flow/contracts/candidate-state-machine.md` — 상태 전이 다이어그램·표(설계 근거 문서).

## 구현 단계

1. **상태 enum 확정.** `candidateStatuses = ['AI_ORGANIZED','SOURCE_VERIFIED','NEEDS_CHECK','NEEDS_APPROVAL','PUBLISHED','CONFLICTED']`. 각 값에 한국어 표시 라벨 매핑(`CANDIDATE_STATUS_LABEL`).
2. **상태 기계.** 전이 규칙을 표로 정의: 인입 직후 → `AI_ORGANIZED`; claim이 원본/링크에 연결되면 → `SOURCE_VERIFIED`; 위험도 충족 시 → `NEEDS_APPROVAL`; 대화/약한 출처 → `NEEDS_CHECK`; 기존 공식 지식과 모순 → `CONFLICTED`; 승인 또는 자동통과 → `PUBLISHED`.
3. **위험도 규칙.** `riskFactors = ['policy','regulation','contract','security','pricing','official_answer','no_source','conflict','external_exposure']`. `needsReview(candidate)`는 riskFactor가 하나라도 있으면 `true`. (정책성/규정/계약/보안/가격/공식답변/출처없음/충돌/외부공개)
4. **provenance 규칙.** `CandidateProvenance`에 `kind: 'file'|'url'|'datasource'|'conversation'|'manual'`, 그리고 대화일 때 `conversationQuote`, `speaker`, `createdFromConversation`, `needsSource` 선택 필드. `kind==='conversation'`이면 기본 `needsSource=true`, 기본 상태 `NEEDS_CHECK`.
5. **auto-publish 조건.** `canAutoPublish(candidate) = !needsReview(candidate) && status in {AI_ORGANIZED, SOURCE_VERIFIED} && provenance.kind !== 'conversation'`.
6. **매핑표 코드화.** 후보 상태 → 기존 `documents.status`로의 투영(`PUBLISHED→PUBLISHED`, 그 외→`REVIEW`/`DRAFT`)을 상수로 둬 PR-27이 DB에 반영할 수 있게 한다.

## 테스트

- `needsReview`: 각 riskFactor 단독·복수·없음 케이스.
- `canAutoPublish`: 대화 출처 배제, 위험 후보 배제, 일반 후보 허용.
- 상태 전이: 허용/금지 전이 매트릭스 단위 테스트.
- provenance 기본값: `kind==='conversation'` → `needsSource=true`, 상태 `NEEDS_CHECK`.

## DoD

- [ ] 후보 상태·위험도·provenance·auto-publish가 단일 모듈에서 타입+순수함수로 정의된다.
- [ ] `documentStatuses` ↔ candidate status 매핑이 상수로 존재한다.
- [ ] 상태 전이 다이어그램 문서가 `contracts/`에 있다.
- [ ] 후속 PR(27~35)이 본 모듈만 import하면 상태 정의가 일치한다.

## 리스크·메모

- 이 PR은 코드량은 적지만 **모든 후속 PR의 어휘를 고정**하므로 리뷰 우선순위 최상.
- 한국어 라벨은 Overview §2.1·§2.2 용어를 그대로 따른다(UI 일관성).
- 상태 enum은 추후 확장 가능하도록 string union으로 두되, 기본 6종 외 추가는 본 contract 개정으로만.
