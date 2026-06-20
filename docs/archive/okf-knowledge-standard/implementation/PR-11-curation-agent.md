# PR-11 — 큐레이션 에이전트 (grep 재검증 · enhance/create/skip · reference 그라운딩)

> Phase 6 · 선행: PR-05, PR-10 · 근거: [`05` §4](../05-curation-agent.md), [`06` §2](../06-adoptable-patterns.md)

## 목표
파이프라인 C의 코어 에이전트. 신선도 초과 개념을 grep으로 재검증하고, 변동 시에만 가산적으로 보강(enhance/create/skip, 의심시 skip)한다. reference 베이스라인으로 그라운딩.

## 범위
- **In:** 큐레이션 `ToolLoopAgent`, grep 재검증, 3-way 결정, `wkf reference` 그라운딩, "변경없음→last_verified만" 분기, 검토 큐 연결.
- **Out:** 비축소 *강제*는 PR-12(여기선 프롬프트 가드레일), 외부 크롤 PR-19.

## 변경 파일
- 🔧 `workers/curation/src/pipeline.ts`(잡 핸들러 → 에이전트)
- 🔧 `packages/agent-tools`(`CURATION_SYSTEM_PROMPT`, reference 주입 도구)

## 구현 단계
1. 잡 수신 → 대상 개념 `wkf reference`(읽기전용 현재본) 컨텍스트 주입.
2. `ToolLoopAgent`([`05` §4.3]): tools `{ toolReadConcept, toolGrepVerify, toolWriteConcept }`, `instructions=CURATION_SYSTEM_PROMPT`([`05` §4.4]), `stopWhen=stepCountIs(policy.enrichment.agent_step_limit)`.
3. 흐름: grep으로 원문 팩트 재확인 →
   - **변동 없음:** write 안 함, `last_verified`만 갱신([`05` §4.2]).
   - **변동 있음:** enhance(가산) 또는 create(4조건) → `tool_merge`로 초안 → status=REVIEW(또는 정책상 auto-publish).
   - **의심:** skip.
4. 결과를 검토 큐/파이프라인 우선순위로 연결.

## 테스트
- 변동 없음 시나리오: write 호출 0, `last_verified` 갱신.
- 변동 있음: 가산 보강 초안 생성 + REVIEW 전환.
- `MockLanguageModelV3`+`mockValues`로 결정론적 스크립트([`docs/13`]).
- reference가 read-only로 주입(쓰기 시도 차단).

## DoD
- [x] SLA 초과 개념이 재검증되고, 원문 미변동 시 재작성하지 않는다.
- [x] 변동 시 가산 보강 초안이 검토로 올라간다.
- [x] 의심 케이스는 skip.

완료 증거:
- 구현 PR: <https://github.com/syleeVeluga/WekiFlow_PoC/pull/22>
- 검증: `corepack pnpm -r build`, `corepack pnpm -r typecheck`, `corepack pnpm -r test`

## 리스크·메모
- 파괴적 재작성은 여기 프롬프트 + PR-12 쓰기 강제의 **2중 방어**.
- grep은 기존 `tool_execute_sandbox_terminal`(read-only `/docs`) 재사용.
