# PR-04 — 번들 레이아웃 + `wkf init/status/pull` (DB→번들, baseRev)

> Phase 5 · 선행: PR-02 · 근거: [`09` §B](../09-enrichment-harness-and-mdcode.md), [`07` §2·§4](../07-knowledge-format-and-generation.md)

## 목표
git-backed 번들 디렉터리 레이아웃을 확정하고, DB의 published 문서를 번들 파일로 내보내는(`pull`) 단방향 동기화 + 로컬 변경 탐지(`status`)를 구현한다. 낙관적 락의 토대인 **baseRev(content hash)** 를 도입.

## 범위
- **In:** `wkf init`(매니페스트), `wkf pull`(DB→번들 + baseRev 기록), `wkf status`(로컬 변경 탐지), 번들 레이아웃.
- **Out:** `push`(PR-05), `reindex`(PR-06), `index.md` 생성(PR-08).

## 변경 파일
- 🆕 `packages/wkf/src/cli.ts`(명령 디스패치), `sync/pull.ts`, `sync/status.ts`, `manifest.ts`
- 🆕 `packages/wkf/bin/wkf`(또는 `package.json` `bin`)
- 🆕 `knowledge/`(번들 루트, gitignore 제외) — `wkf.yaml` 매니페스트

## 구현 단계
1. 번들 레이아웃([`07` §2]): `knowledge/<dir>/<slug>.md`, `index.md`, `log.md`, 루트 `wkf.yaml`(scope·snapshot·publishing·reference 블록 [`09` §A.1]).
2. `wkf init`: `wkf.yaml` 생성, 빈 번들 골격.
3. `wkf pull`: `documents`(status=PUBLISHED)를 `fromMongo`→`serialize`로 파일 기록. 각 개념 메타에 **`baseRev = contentHash`** 를 사이드 저장(`.wkf/state.json` 또는 frontmatter 비노출 필드).
4. `wkf status`: 로컬 파일 hash vs `baseRev` 비교 → 변경 목록 출력. `--dry-run` 공통 플래그.

## 테스트
- `pull` 후 번들 파일이 DB 내용과 일치(`parse` 결과 비교).
- `status`: 파일 수정 시 변경 감지, 무수정 시 clean.
- 멱등: `pull` 2회 시 동일 결과.

## DoD
- [x] `wkf init`/`pull`/`status`가 동작하고 `--dry-run` 지원.
- [x] 각 개념에 `baseRev`가 기록된다(PR-05 락의 입력).
- [x] `pull`이 멱등.

## 리스크·메모
- contentHash는 `serialize` 정규화 출력 기준(공백/키순서 안정화 필수, PR-02 의존).
- 번들은 git 저장소로 둘지(서브모듈/별도 repo) 결정 필요 — 1차는 `knowledge/` 동일 repo 디렉터리.
