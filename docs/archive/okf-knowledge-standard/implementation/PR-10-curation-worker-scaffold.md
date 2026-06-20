# PR-10 — `workers/curation` 스캐폴드 + repeatable(cron) + `scanStale`

> Phase 6 · 선행: PR-09 · 근거: [`05` §4](../05-curation-agent.md), [`09` §A](../09-enrichment-harness-and-mdcode.md)

## 목표
파이프라인 C의 뼈대: 스케줄 트리거(BullMQ repeatable)와 신선도 SLA 초과 개념 선별(`scanStale`)을 구현한다. 에이전트 로직(PR-11) 전 단계.

## 범위
- **In:** `workers/curation` 워커, repeatable job 등록, `wkf.scanStale(bundle, policy)`, 큐잉.
- **Out:** 큐레이션 에이전트 실행(PR-11), 비축소 강제(PR-12), log.md(PR-13).

## 변경 파일
- 🆕 `workers/curation/`(package, src/index.ts, src/pipeline.ts)
- 🆕 `packages/wkf/src/scan.ts`(`scanStale`)
- 🔧 `packages/queue`(Curation Queue prefix 추가)

## 구현 단계
1. `scanStale(bundle, policy)`: 각 개념의 `last_verified`(or `timestamp`) + type별 `freshness` SLA 비교 → 초과분 반환(전수 순회 아님 = 비용·드리프트 통제).
2. `workers/curation` 워커: BullMQ repeatable(`{ repeat: { pattern: '0 3 * * *' } }`) → `scanStale` → 개념별 잡 enqueue(Curation Queue).
3. 이 PR의 잡 핸들러는 **placeholder**(로그만) — PR-11에서 에이전트 연결.
4. `noeviction` Redis 정합([`docs/02`]).

## 테스트
- `scanStale`: SLA 초과/미초과 분류 정확(type별 다른 SLA).
- repeatable 등록·중복 방지(jobId 고정).
- placeholder 핸들러가 큐잉된 개념을 수신.

## DoD
- [x] cron 트리거가 `scanStale` 결과를 큐잉한다.
- [x] SLA가 type별로 정확히 적용된다.
- [x] 워커가 기동/종료 깔끔(graceful shutdown).

완료 증거:
- 구현 PR: <https://github.com/syleeVeluga/WekiFlow_PoC/pull/20>
- 검증: `corepack pnpm -r build`, `corepack pnpm -r typecheck`, `corepack pnpm -r test`

## 리스크·메모
- 폭주 방지: 1회 스캔당 최대 N개만 큐잉(배치 상한) — 큰 번들 대비.
