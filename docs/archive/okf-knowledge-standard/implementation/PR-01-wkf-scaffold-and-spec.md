# PR-01 — `packages/wkf` 스캐폴드 + WKF v0.1 스펙 + frontmatter 타입

> Phase 5 · 선행: 없음 · 근거: [`04`](../04-wekiflow-knowledge-spec.md), [`07` §1](../07-knowledge-format-and-generation.md)

## 목표
WKF(WekiFlow Knowledge Format) v0.1을 코드화할 새 워크스페이스 패키지를 만들고, frontmatter 계약을 zod 타입으로 고정한다. 이후 모든 PR의 토대.

## 범위
- **In:** 패키지 스캐폴드, `SPEC.md`(스펙 본문), frontmatter zod 스키마, `type` 권장 어휘 상수, 공개 타입 export.
- **Out:** parse/serialize 로직(PR-02), validate(PR-03), CLI(PR-04~).

## 변경 파일
- 🆕 `packages/wkf/package.json` (`"type":"module"`, exports, `zod` dep)
- 🆕 `packages/wkf/tsconfig.json` (base 상속, `NodeNext`)
- 🆕 `packages/wkf/SPEC.md` ([`04`](../04-wekiflow-knowledge-spec.md) 내용 정식화)
- 🆕 `packages/wkf/src/types.ts` (zod 스키마 + 추론 타입)
- 🆕 `packages/wkf/src/index.ts` (배럴 export)
- 🔧 `pnpm-workspace.yaml`/루트 `tsconfig` 참조(필요 시)

## 구현 단계
1. `packages/wkf` 생성, `package.json`에 `name:"@wekiflow/wkf"`, `zod` 의존.
2. `types.ts`에 frontmatter 스키마 정의:
   ```ts
   export const FrontmatterSchema = z.object({
     type: z.string().min(1),                       // 필수
     title: z.string().optional(),
     description: z.string().optional(),
     resource: z.string().optional(),
     tags: z.array(z.string()).default([]),
     timestamp: z.string().datetime().optional(),
     // WKF 확장
     source_tier: z.enum(['official','internal','external','unverified']).optional(),
     freshness: z.string().optional(),              // "90d"
     last_verified: z.string().datetime().optional(),
     status: z.enum(['DRAFT','PROCESSING','REVIEW','PUBLISHED','GRAPH_INDEXED','FAILED']).optional(),
     slug: z.string().optional(),
   }).passthrough();                                 // 모르는 키 보존(OKF 관용성)
   ```
3. `RECOMMENDED_TYPES` 상수(`REGULATION|POLICY|PLAYBOOK|METRIC|ENTITY|DATASET|PERSON|DEPT`), `WkfDoc` 타입(`{ frontmatter, body }`), `Triplet` 타입.
4. `SPEC.md`에 적합성 MUST(§PR-03에서 강제할 규칙) 명문화.

## 테스트
- `types.test.ts`: `type` 누락 시 parse 실패, 모르는 키 `passthrough` 보존, `tags` 기본값 `[]`.

## DoD
- [x] `pnpm -r build` 후 `@wekiflow/wkf` 빌드 통과.
- [x] `FrontmatterSchema`가 필수/권장/확장/passthrough를 정확히 표현.
- [x] SPEC.md가 [`04`]와 일치.

## 리스크·메모
- `.passthrough()`로 OKF의 "모르는 키 보존" 보장 — 깨지면 호환성 위반.
- zod 버전은 워커와 동일(`zod@4`, [`docs/13`](../../13-implementation-decisions.md)).
