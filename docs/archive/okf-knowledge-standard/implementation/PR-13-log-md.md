# PR-13 — `log.md` 자동 append (A/B/C)

> Phase 6 · 선행: PR-04 · 근거: [`04` §6](../04-wekiflow-knowledge-spec.md), [`05` §4.2](../05-curation-agent.md)

## 목표
승인/변경 시 사람이 읽는 개념별 변경 이력(`log.md`)을 자동으로 1줄 추가한다. 기계 감사(`jobs.agentSteps`)와 별개로 신뢰 판단 근거를 남긴다.

## 범위
- **In:** `wkf.appendLog(dir, entry)`, 파이프라인 A/B/C 승인·변경 훅 연결, 날짜 그룹·접두사 형식.
- **Out:** UI 렌더(후속 apps/web).

## 변경 파일
- 🆕 `packages/wkf/src/log.ts`(`appendLog`)
- 🔧 `workers/main`·`workers/graph`·`workers/curation`(승인/변경 시 호출)
- 🔧 `apps/api`(승인 라우트)

## 구현 단계
1. `appendLog(dir, { date, kind, slug, summary, actor, pipeline })`:
   - 날짜 그룹(`## YYYY-MM-DD`, 최신 우선), `- **Creation|Update|Verify** <slug>: <summary> (출처…). 검토 <actor>. [A|B|C]`.
   - 같은 날짜 그룹에 append, 없으면 생성.
2. 호출 지점:
   - A(신규/병합 승인) → **Creation/Update [A]**
   - B(관계 갱신) → **Update [B]**(선택)
   - C(재검증) → 변동 시 **Update [C]**, 무변동 시 **Verify [C]**([`05` §4.2]).
3. `log.md`는 예약 파일 — `validate`(PR-03) 구조 점검 대상.

## 테스트
- append 멱등성(중복 1줄 방지), 날짜 그룹 정렬.
- A/B/C 각 경로에서 올바른 접두사·`[X]` 태그.
- `Verify`(무변동) 기록 동작.

## DoD
- [x] 승인/재검증 시 `log.md`에 정확한 1줄이 남는다.
- [x] 무변동 재검증도 `Verify`로 기록된다.
- [x] `log.md`가 `validate`를 통과.

완료 증거:
- 구현 PR: <https://github.com/syleeVeluga/WekiFlow_PoC/pull/26>
- 검증: `corepack pnpm -r build`, `corepack pnpm -r typecheck`, `corepack pnpm -r test`

## 리스크·메모
- 동시 append 경쟁 → push(PR-05) 락 경로 안에서 수행하거나 파일 단위 직렬화.
