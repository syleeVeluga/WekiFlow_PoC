# PR-22 — 런타임 config 저장소 (토대)

> 원본 계획 §B. 제어판의 **데이터/머지 토대**. 프롬프트·인자·모델·정책 오버라이드를 한 곳에 저장·해소한다.
> 상태: 미착수 · 선행: PR-21(게이트) · 후행: PR-23, PR-24, PR-25

## 목표
DB에 저장된 부분 오버라이드를 **빌트인 기본 + env 위에 머지**해 effective config를 돌려주는 런타임 config 저장소와 API를 만든다. 빌트인 기본값(프롬프트 상수, stepLimit, k 등)을 단일 출처로 모은다. 이 PR은 저장/머지/API까지 — 실제 주입(워커 배선)은 PR-23/24.

## 범위
- `RuntimeConfigSchema`(prompts/agentParams/models/policy) 정의.
- repo `runtimeConfig.get()/update(patch)` (Mongo 단일 문서 + InMemory 미러).
- `loadRuntimeConfig(db)` 머지 헬퍼 + 빌트인 기본 단일 출처화.
- `GET/PATCH /api/admin/config` (PR-21 게이트 하위).

## 스키마 (`packages/shared`)
```
RuntimeConfigSchema = {
  prompts: Partial<Record<PromptKey, string>>   // 키없음/null = 빌트인 사용
  agentParams: {
    mainStepLimit?, discoveryStepLimit?, curationStepLimit?,
    vectorK?, hybridK?, graphMaxDepth?, sandboxTimeoutMs?
  }                                              // optional → 하드코딩 기본 fallback
  models: {
    agentModel?, embeddingModel?, tripletGoogleModel?,
    tripletAnthropicModel?, tripletOpenAiFallbackModel?
  }                                              // env 위 오버라이드(API 키 제외)
  policy: Policy | null                          // null = policy.yaml
}
PromptKey = 'main'|'curation'|'merge'|'discoveryDecompose'|'discoverySystem'|'learnerJudge'
```
- zod 경계 검증: 현 스키마 범위 반영 — 예 `vectorK` 1–50, `graphMaxDepth` 1–3, `sandboxTimeoutMs` 양수 상한. 기존 하드코딩 값과 동일 범위로 맞출 것.

## 변경 파일
- `packages/shared/src/index.ts` — `RuntimeConfigSchema`, `PromptKey`, 빌트인 기본 상수 모음(또는 `defaults.ts`).
- `packages/db` — `runtimeConfig` repo. Mongo `app_config` 컬렉션 `_id:'runtime'` 단일 문서 upsert.
- `apps/api` — InMemory store 미러(테스트용) + `GET /api/admin/config`·`PATCH /api/admin/config`.

## 머지/로딩 규율
- `loadRuntimeConfig(db)`: DB 오버라이드 → env → 빌트인 기본 순으로 머지해 effective 반환. 오버라이드 없으면 빌트인 기본 그대로.
- `GET /api/admin/config`: effective + **각 항목 기본값**을 함께 반환(UI가 "기본 vs 오버라이드" 표시).
- `PATCH /api/admin/config`: 부분 patch, zod 검증 후 저장. null/누락은 "기본 사용"으로 해석.
- **워커 로딩 규율(문서화)**: config는 **잡마다** 로드. 모델 변경은 신규 잡부터 적용, 실행 중 잡 불변 — 이 PR에선 헬퍼/문서만, 실제 배선은 PR-23/24.

## 작업 순서
1. 빌트인 기본값을 한 곳에 수집(현 상수/하드코딩: 프롬프트, stepLimit 12/8, k 8, hybrid 8, maxDepth 2, sandbox 10s). 기존 코드는 이 출처를 참조하도록 정리(동작 불변).
2. `RuntimeConfigSchema` + zod 경계 정의.
3. `packages/db` repo get/update(upsert) 구현 + InMemory 미러.
4. `loadRuntimeConfig` 머지 헬퍼.
5. API 2개 엔드포인트, PR-21 게이트 하위 배치.

## 검증
- `pnpm -r build` → `pnpm -r typecheck` → `pnpm -r test`.
- 단위: get/update 라운드트립; effective 머지(오버라이드 없을 때 빌트인 기본 반환); zod 경계값(범위 밖 거부); patch 부분 업데이트가 타 필드 보존; null = 기본 복원.
- 수동: `PATCH`로 `vectorK` 변경 → `GET`에 effective 반영 + 기본값 동시 노출 확인.

## 완료 기준
- 빌트인 기본이 단일 출처화되고, DB 오버라이드가 안전하게 머지됨.
- API가 게이트 하위에서 effective+기본을 제공 — UI(PR-25)가 바로 소비 가능.

## 범위 밖
- 워커 주입 배선(PR-23 프롬프트/인자, PR-24 정책).
- 프롬프트 버전관리·감사 히스토리(단일 오버라이드+기본 복원만).
