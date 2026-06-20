# PR-15 — `workers/learner` (파이프라인 D): 궤적 judge → 제안

> Phase 7 · 선행: PR-03 · 근거: [`08` §A](../08-agent-implementation-specs.md), [`06` §3](../06-adoptable-patterns.md)

## 목표
실행 궤적(`jobs.agentSteps`)을 LLM-as-judge로 평가해 지식 격차/할루시네이션을 탐지하고 `WkfEnrichmentProposal[]`을 생성한다. "실사용 실패에서 역으로 학습"하는 세 번째 갱신 축.

## 범위
- **In:** `workers/learner` 워커, judge 에이전트, `WkfEnrichmentProposal` zod 스키마, 제안 → 검토 큐/C 우선순위 연결, PII 레닥션.
- **Out:** 회귀 골든셋(PR-16), Discovery(PR-17/18).

## 변경 파일
- 🆕 `workers/learner/`(package, src/index.ts, src/pipeline.ts)
- 🆕 `packages/agent-tools/src/learner.ts`(`WkfEnrichmentProposal` 스키마 [`08` §A.3])
- 🔧 `packages/db`(proposals 컬렉션)

## 구현 단계
1. 트리거: 잡 완료 훅 또는 스케줄 → 최근 `jobs.agentSteps` 묶음 로드.
2. judge(`generateObject`, schema=`TrajectoryAnalysisResult`): 신호 매핑([`08` §A.2]) — verify 실패→근거부재, graph 빈경로→관계부재, vector 저점수+grep성공→동의어부재, off-tree hit→신규문서.
3. `instruction`에 실행 명령만(배경 제외), `evidence.stepQuote`에 궤적 인용, PII `[REDACTED]`.
4. 제안 저장(`proposals` 컬렉션) → 검토 큐 또는 파이프라인 C `scanStale` 우선순위 입력.
5. 격차 없으면 빈 배열.

## 테스트
- `MockLanguageModelV3`+`mockValues`로 궤적→제안 결정론적 검증.
- verify 실패 궤적 → `MISSING_CITATION` 제안.
- graph 빈 경로 → `MISSING_RELATION`.
- PII 레닥션 동작.

## DoD
- [x] 실패 궤적에서 `WkfEnrichmentProposal`이 생성되어 검토 큐로 들어간다.
- [x] 신호→gapType 매핑이 정확.
- [x] PII가 제안 필드에 노출되지 않는다.

## 리스크·메모
- 비용: 전수 평가 대신 verify 실패/저점수 등 **신호 있는 궤적만** 평가.
- 신호 인프라(`agentSteps`)가 이미 존재 → 투자 대비 효과 최상([`06` §3]).
