# PR-19 — (선택) 외부 allowlist 크롤 enrichment

> Phase 7 · 선택(🟡) · 선행: PR-11 · 근거: [`05` §4](../reference/okf-knowledge-standard/05-curation-agent.md), [`09` §A.2](../reference/okf-knowledge-standard/09-enrichment-harness-and-mdcode.md), [`01` §3](../archive/okf-knowledge-standard/01-reference-analysis.md)

## 목표
파이프라인 C(큐레이션)에 외부 권위 소스 크롤을 추가한다. 단, **한도는 도구 레이어에서 하드 강제**(OKF 철학): `policy.yaml`의 `allowed_hosts`·`web_max_pages`.

## 범위
- **In:** `toolFetchUrl`(allowlist·page 상한 강제), enhance/create/skip에 외부 페이지 판단 추가, 결과 `references/` 적재.
- **Out:** 핵심 큐레이션(PR-11), 사내 grep(이미 PR-11).

## 변경 파일
- 🆕 `packages/agent-tools/src/fetchUrl.ts`(allowlist·상한·재시도 금지)
- 🔧 `workers/curation`(외부 보강 분기)

## 구현 단계
1. `toolFetchUrl(url)`: `policy.sources.allowed_hosts` 밖이면 거부, 누적 fetch > `web_max_pages`면 거부, **거부 URL 재시도 금지**([`05` §2.4]).
2. 큐레이션 에이전트가 외부 페이지마다 enhance/create/skip 판단(create는 4조건, [`05` §2.2]) → `references/`에 1급 출처 문서로 저장([`07` §2]).
3. 모든 외부 지식은 `# Citations`에 실제 fetch URL만 인용(창작 금지).
4. 결과는 검토 게이트 통과 후 반영.

## 테스트
- allowlist 밖 도메인 거부, 상한 초과 거부.
- create/enhance/skip 분기.
- 인용에 fetch한 URL만.

## DoD
- [ ] 외부 크롤이 allowlist·상한 내에서만 동작하고 폭주하지 않는다.
- [ ] 외부 지식이 `references/`에 출처와 함께 적재된다.

## 리스크·메모
- 결정 #7 기본값은 "사내만" — 이 PR로 외부를 **명시 opt-in**.
- 한도 주체는 프롬프트가 아니라 도구([`09` §A]).
