# PR-23 — 프롬프트 주입 seam + 인자 배선

> 원본 계획 §C (+ §B의 agentParams 워커 주입). 하드코딩 프롬프트/인자를 **런타임 오버라이드 가능**하게 만든다.
> 상태: 완료 · 구현 PR: #35 · 선행: PR-22(config 저장소) · 후행: PR-25(UI 편집)

## 목표
프롬프트 상수는 **기본값으로 유지**하면서, 각 팩토리/빌더가 컨텍스트의 오버라이드를 받아 사용하도록 seam을 추가한다. 워커가 `loadRuntimeConfig()`의 prompts·agentParams를 ctx로 주입한다. 오버라이드가 없으면 **동작 완전 불변**.

## 범위
- agent-tools 프롬프트 seam(상수 fallback 패턴).
- 워커(main/curation/learner) + discovery 호출부에 prompts·agentParams 주입.

## 변경 파일
- `packages/agent-tools/src/index.ts` — `MAIN_AGENT_SYSTEM_PROMPT`·`CURATION_SYSTEM_PROMPT`·`MERGE_SYSTEM_PROMPT` 사용처를 `ctx.prompts?.main ?? MAIN_AGENT_SYSTEM_PROMPT` 형태로.
- `packages/agent-tools/src/discovery.ts` — `DISCOVERY_DECOMPOSE_PROMPT`·`DISCOVERY_SYSTEM_PROMPT` 동일 seam.
- `packages/agent-tools/src/learner.ts` — `LEARNER_JUDGE_PROMPT` 동일 seam.
- `workers/main/src/pipeline.ts` — 잡 시작 시 `loadRuntimeConfig()`; prompts·agentParams(특히 `mainStepLimit`, 기본 12)를 ctx 주입.
- `workers/curation/*` — scan마다 이미 정책 로드 → 같은 지점에서 config 로드, `curationStepLimit` 등 주입.
- `workers/learner/*` + discovery 호출부 — `discoveryStepLimit`(기본 8), prompts 주입.
- 검색/그래프/샌드박스 인자(`vectorK`/`hybridK`/`graphMaxDepth`/`sandboxTimeoutMs`)를 사용하는 호출부 — effective 값 사용.

## 작업 순서
1. agent-tools: 팩토리/빌더 시그니처에 prompt 오버라이드(ctx) 수용. `?? 상수` fallback. 동작 불변 확인.
2. agentParams: 기존 `ctx.stepLimit` 등 이미 주입 가능한 항목은 그대로 활용, 없는 항목만 ctx 확장.
3. 워커별로 `loadRuntimeConfig()` 호출 위치 확정(**잡/스캔 단위**) 후 ctx 구성.
4. 모델 오버라이드(`models.*`)도 잡 시작 시 effective로 클라이언트 구성에 반영(API 키는 env 유지).

## 로딩 규율 (재확인)
- main: 잡 시작 시 1회 로드. curation: scan마다. discovery/learner: 잡 시작 시.
- 모델/인자 변경은 **신규 잡부터** 적용, 실행 중 잡 불변. (UI/문서 명시는 PR-25.)

## 검증
- `pnpm -r build` → `pnpm -r typecheck` → `pnpm -r test`.
- 단위: 프롬프트 seam — 오버라이드 주입 시 그 값, 없으면 상수; agentParams 오버라이드 시 effective 값으로 루프/검색 동작(예 stepLimit, vectorK 경계).
- 회귀: 오버라이드 전무 시 기존 스냅샷/동작 불변(프롬프트 문자열·한도 동일).
- 수동: config로 main 프롬프트 변경 → 신규 agent-preview 잡에서 반영, 「기본 복원」 후 상수 사용 확인.

## 완료 기준
- [x] 6개 프롬프트 키 + agentParams가 런타임 오버라이드 경로로 흐름.
- [x] 오버라이드 없을 때 빌트인과 바이트 동일 동작.

## 완료 기록
- 병합: PR #35 (`Wire runtime prompt and agent parameter overrides`)
- 검증: `corepack pnpm verify:testing`

## 범위 밖
- UI 편집기(PR-25). 정책 오버라이드(PR-24). env API 키 편집(영구 제외).
