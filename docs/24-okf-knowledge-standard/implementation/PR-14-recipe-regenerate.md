# PR-14 — (선택) `recipe.yaml` + `wkf regenerate`

> Phase 6 · 선택(🟡) · 선행: PR-06 · 근거: [`07` §3](../07-knowledge-format-and-generation.md)

## 목표
지식 영역별 생성 레시피(`recipe.yaml`)를 저장해, 모델/프롬프트 개선 후 번들을 재현 가능하게 재생성한다. provenance 강화 + 파이프라인 C 시드 연계.

## 범위
- **In:** `recipe.yaml` 스키마(소스 목록·시드·생성 파라미터), `wkf regenerate <dir>`(파이프라인 A 선언적 재실행).
- **Out:** 외부 크롤(PR-19).

## 변경 파일
- 🆕 `packages/wkf/src/recipe.ts`
- 🔧 `workers/main`(regenerate 진입점 재사용)

## 구현 단계
1. `recipe.yaml`: `sources: [{type, ref}]`, `seeds: [url]`(allowlist 내), `params: {model, instruction}`.
2. `wkf regenerate <dir>`: recipe를 읽어 파이프라인 A를 재실행(인입 본문 = 소스), 결과를 번들에 반영(push 경유 → 검토 게이트).
3. recipe는 git에 보관 → "이 지식이 어떻게 만들어졌나" 감사.

## 테스트
- recipe 파싱/검증.
- regenerate가 동일 입력에 안정적 결과(스냅샷).

## DoD
- [ ] `recipe.yaml`로 영역 재생성이 가능하다.
- [ ] recipe가 provenance로 git에 남는다.

## 리스크·메모
- 선택 PR — 핵심 게이트(Phase 5/6) 통과 후 착수. 시드는 PR-19 외부 크롤과 공유.
