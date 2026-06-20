# PR-33 — Knowledge Map: Markdown 링크 그래프 + 화면 (T5)

> Track T5 · 상태: 완료(PR #45, 2026-06-21) · 선행: [PR-26](./PR-26-candidate-contract.md) (KG는 기구현) · 근거: [`Overview.md`](./Overview.md) §3.5·§5.1-4·§5.2-4, [`Gap-Analysis.md`](./Gap-Analysis.md) §2.4·§3.4
> 외부 API 메모: 없음(내부 bundle 기반).

## 목표

OKF `visualize` 패턴에 맞춰 **Markdown 링크 기반 지식 맵**을 만든다. typed `# Relations` KG를 강제하지 않고, Markdown cross-link·backlinks·tags·headings를 1차 단서로 그래프를 추출·렌더한다. typed relations는 advanced toggle로 추가한다.

## 범위

- **In:**
  - Markdown 링크 그래프 추출(노드=개념/문서, edge=cross-link, backlinks).
  - `wkf visualize <bundle>` CLI(단일 viz.html) 및/또는 graph API.
  - 웹 "지식 맵" 화면(graph/detail/search/type filter/backlinks/layout).
- **Out:** typed KG 신규 구현(이미 존재), 답변 내 그래프 인용(→ PR-34).

## 변경 파일

- 🆕 `packages/wkf/src/linkGraph.ts` — `extractLinkGraph(bundle)` (Markdown 링크·backlinks·tags 파싱 → 노드/엣지).
- 🔧 `packages/wkf/src/cli.ts` — `visualize` 서브커맨드 추가(viz.html 렌더).
- 🆕 `apps/api/src/routes/knowledgeMap.ts` — `GET /api/knowledge-map`(노드/엣지 JSON).
- 🆕 `apps/web/src/components/map/KnowledgeMapPage.tsx` — 그래프 화면.
- 🔧 `apps/web/src/store.ts` — `activePage`에 `map` 추가; `sources/rules/history` stub 정리.

## 구현 단계

1. **링크 추출.** bundle의 `.md`에서 Markdown 링크(`[text](path)`)·heading·tags 파싱 → 노드/엣지. backlinks는 역방향 집계. (typed `# Relations`는 별도 레이어로 분리.)
2. **CLI visualize.** `wkf visualize <bundle>` → 자족 `viz.html`(개념 노드·cross-link edge·frontmatter·body·backlinks·search·type filter·layout switch). OKF README 항목 대응.
3. **graph API.** 웹 화면용 `GET /api/knowledge-map`(workspace 스코프) — 노드/엣지/메타 JSON.
4. **웹 화면.** 그래프 뷰 + 노드 클릭 시 detail(frontmatter·body·backlinks) + 검색 + type filter + layout switch. v1은 Markdown 링크 기반.
5. **advanced toggle.** typed relations(KG)를 토글로 오버레이(기존 `searchKnowledgeGraph`/`kg_edges` 재사용).

## 테스트

- `extractLinkGraph`: 링크·backlink·tag 파싱 정확성, 순환·깨진 링크 처리.
- CLI: 샘플 bundle → viz.html 생성, 주요 요소 포함.
- API: workspace 스코프 노드/엣지 반환.
- UI: 검색/필터/layout/backlinks 동작, advanced toggle로 typed relations 표시.

## 검증

- PR #45: <https://github.com/syleeVeluga/WekiFlow_PoC/pull/45>
- `corepack pnpm --filter @wekiflow/wkf test -- linkGraph`
- `corepack pnpm --filter @wf/web typecheck`
- `corepack pnpm --filter @wf/api test -- server`
- `corepack pnpm -r typecheck`
- `corepack pnpm -r test`
- `corepack pnpm build`
- GitHub CI `verify` on PR #45
- Playwright smoke with mocked `/api/knowledge-map`: rendered nodes, search filter, list mode, typed relation toggle.

## DoD

- [x] Markdown 링크 기반 그래프가 추출된다.
- [x] `wkf visualize`가 자족 viz.html을 생성한다.
- [x] 웹 "지식 맵" 화면에서 탐색·검색·필터·backlinks가 동작한다.
- [x] typed relations는 advanced toggle로 분리된다.

## 리스크·메모

- v1은 의도적으로 Markdown 링크만 — typed KG 강제는 멀티홉 정밀 질의 시에만(Overview §2.3·§3.4).
- 그래프 렌더 라이브러리는 경량(예: 캔버스/SVG force) 선택, 대규모 bundle 성능은 후속 최적화.
- 고객 PoC에서 "AI가 정리한 조직 지식 연결" 신뢰/탐색 데모로 활용.
