# PR-08 — `wkf index` (자동 `index.md` 생성)

> Phase 5 · 선행: PR-02 · 근거: [`07` §4](../07-knowledge-format-and-generation.md)

## 목표
번들 디렉터리 트리를 순회해 네비게이션용 `index.md`를 멱등 생성한다. 프론트의 "문서 트리"가 이 index.md를 읽어 렌더되도록 한다.

## 범위
- **In:** `wkf index [--check]`, 디렉터리별 `index.md` 생성 규칙(타입 그룹화·상대링크·설명 상속·빈 디렉터리 스킵·단일자식 설명 재사용).
- **Out:** 프론트 렌더(별도 apps/web PR, Phase 5 후속).

## 변경 파일
- 🆕 `packages/wkf/src/index-gen.ts`
- 🔧 `packages/wkf/src/cli.ts`

## 구현 단계
1. 트리 순회 → 각 디렉터리에 대해:
   - 하위 디렉터리/문서를 타입별 그룹화, `* [Title](path) - description` 목록 생성.
   - 설명은 자식 frontmatter `description`에서 상속.
   - **빈 디렉터리 스킵**, **단일 자식이면 자식 설명 재사용**([`07` §4]).
   - `index.md`는 frontmatter 없음(루트만 `okf_version`/`wkf_version`).
2. `--check` 모드: 생성 결과가 현재 파일과 다르면 비-0 종료(CI 드리프트 감지).
3. 멱등: 재실행 시 변화 없음.

## 테스트
- 트리 픽스처 → 기대 index.md 일치.
- 빈 디렉터리 스킵, 단일 자식 설명 재사용.
- `--check`가 드리프트 시 실패.

## DoD
- [x] `wkf index`가 트리 전체 index.md를 멱등 생성.
- [x] `--check`로 CI에서 미생성 index 드리프트를 잡는다.

완료 증거:
- 구현 PR: <https://github.com/syleeVeluga/WekiFlow_PoC/pull/16>
- 검증: `corepack pnpm -r build`, `corepack pnpm -r typecheck`, `corepack pnpm -r test`

## 리스크·메모
- reindex(PR-06)와 별개(번들 내부 생성 vs 번들→DB). 커밋 훅에서 `wkf index` + `wkf reindex` 순차 실행 권장.
