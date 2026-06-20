# OKF Enrichment Product Flow — 갭 분석

> 작성일: 2026-06-20
> 기준 문서: [`Overview.md`](./Overview.md), [`../../README.md`](../../README.md)
> 방법: Overview의 목표 방향(§3~§6)과 현재 코드베이스(apps/, packages/, workers/)를 직접 대조
> 목적: Overview가 제시한 제품 흐름 재정렬 방향에 대해 현재 구현이 어디까지 와 있는지(변경사항)를 확인하고, 상세 PR 계획 전 남은 갭을 확정한다.

---

## 0. 요약

현재 WekiFlow는 OKF/WKF 포맷, 인입 파이프라인(Main Agent), 큐레이션, learner, hybrid 검색, typed KG, 정책 엔진, 검토 UI까지 **Phase 0~4 PoC 수준으로 견고하게 구현**돼 있다. Overview가 정의한 목표 방향과 대조하면, 갭은 "엔진이 없다"가 아니라 **"제품 표면 모델이 없다"**에 가깝다.

핵심 결론을 한 줄로 정리하면:

- **이미 있는 것(엔진):** 인입·병합·검증·큐레이션·KG·hybrid 검색·역할 기반 정책.
- **아직 없는 것(제품 흐름):** `KnowledgeCandidate` 1급 모델, 위험도 기반 승인, 대화형 인입, OKF 링크 기반 지식 맵, 신뢰 라벨, 답변의 출처 표시.

상태 표기 규칙: ✅ 충족 / 🟡 부분 / ❌ 미구현.

| GA | 영역 | 상태 | 한 줄 평가 |
| :--- | :--- | :--- | :--- |
| GA-01 | Current Flow Inventory | 🟡 | 코드 경로는 추적됐으나 문서화된 인벤토리/매핑표는 본 문서가 첫 산출물 |
| GA-02 | Target Product Flow Contract | ❌ | 후보 상태 기계·위험도 규칙·provenance 규칙 모두 미정의 |
| GA-03 | Backend Architecture Gap | 🟡 | 엔진은 있으나 새 역할 경계·후보 모델·인입 모드 미반영 |
| GA-04 | Frontend UX Gap | 🟡 | 인입/검토/KB는 있으나 대화 저장·지식 맵·신뢰 라벨 부재 |
| GA-05 | Migration & Simplification | ❌ | 유지/숨김/리네임/제거 목록 및 PR 순서 미작성 |

---

## 1. 현재 구현 인벤토리 (GA-01 대응)

### 1.1 핵심 데이터 모델

`documents` 컬렉션이 사실상 단일 지식 모델이며, 별도의 후보 모델은 없다.

- 스키마: `packages/shared/src/index.ts` (`DocumentSchema`, `DocumentStatusSchema`, `SourceRefSchema`, `IngestionInfoSchema`), 리포지토리: `packages/db/src/repositories.ts`.
- `status` enum (`documentStatuses`): `DRAFT`, `PROCESSING`, `PREVIEW`, `REVIEW`, `PUBLISHED`, `GRAPH_INDEXED`, `FAILED`.
- provenance는 `sourceRefs[]`(type: `upload|datasource|manual|api`)와 `ingestion`(userId, workspaceId, sourceName, idempotencyKey, sourceLabel, jobId 등)으로 추적.
- 역할: `userRoles` = `OWNER > APPROVER > REVIEWER > EDITOR > VIEWER`.

### 1.2 에이전트 / 워커

- **Main(Ingest) Agent** — `workers/main/src/pipeline.ts`, 도구 `packages/agent-tools/src/index.ts`. `MAIN_AGENT_SYSTEM_PROMPT`, `buildIngestPrompt`, `tool_merge`, `tool_verify_integrity`, `tool_search_vector`, `tool_hybrid_retrieve`, `tool_search_graph`, `tool_execute_sandbox_terminal`.
- **Curation Agent** — `workers/curation/src/pipeline.ts`. `tool_read_concept`, `tool_grep_verify`, `tool_fetch_url`, `tool_write_concept`, `assertNoShrinkage`. 결정 타입 `verify/enhance/create/skip`. external enrichment는 `policy.sources.allowed_hosts` + `policy.enrichment.web_max_pages`(기본 50)로 도구 레이어에서 강제.
- **Learner** — `workers/learner/src/pipeline.ts`, `packages/agent-tools/src/learner.ts`. `judgeTrajectory()`가 완료된 job의 `agentSteps`를 분석해 `enrichment_proposals`(gapType, targetSlug, instruction, evidence, priority) 생성.
- **Graph** — `workers/graph/src/pipeline.ts`. 삼중항 추출/병합 → `# Relations` 작성 → MongoDB `kg_nodes`/`kg_edges` 리인덱싱.
- **Discovery** — `packages/agent-tools/src/discovery.ts` (`askDiscovery`), API `POST /api/ask` (`apps/api/src/server.ts`).

### 1.3 WKF / 정책 / 검색

- WKF 포맷·recipe: `packages/wkf/` (`recipe.ts`, `sections.ts`, `policy.ts`, `cli.ts`, `SPEC.md`).
- 정책 엔진: `enforcePolicy(action, doc, policy, context)` — 역할/타입 기반.
- 검색: vector + graph RRF 융합(`fuseHybridRetrieval`), KG BFS(`searchKnowledgeGraph`, depth≤3).

### 1.4 프런트엔드 라우트 맵

`apps/web` (App.tsx의 `activePage` 기반 SPA):

| 페이지 | key | 컴포넌트 | 용도 |
| :--- | :--- | :--- | :--- |
| Home | `home` | HomePage | 대시보드·digest·활동 스트림 |
| Review | `review` | ReviewPage | 후보 카드 + Layer1 diff + 멀티소스 충돌 |
| KB | `kb` | KbPage | 발행 지식 탐색(grid/category/integrated) |
| Doc | `doc` | DocPage | 편집/Source/Relations/History 탭 |
| Add | `add` | AddPage | 파일·수동·API 인입 |
| Users | `users` | UsersPage | 사용자·역할 관리 |
| Trash | `trash` | TrashPage | soft-delete 복원/영구삭제 |
| Agent Preview | `agent` | AgentPreviewPage | OWNER 전용 추출/diff/triplet 디버그 |
| Dev Panel | `dev` | DevPanel | 슈퍼어드민 prompt/param/policy 오버라이드 |
| Sources / Rules / History | `sources`/`rules`/`history` | StubPage | 미구현 placeholder |

> **GA-01 평가(🟡):** 실제 API/DB/UI 코드 경로는 본 문서로 추적·문서화됐다. 다만 Overview가 GA-01 산출물로 요구한 "데이터 흐름 다이어그램"과 "`documents`↔`enrichment_proposals`↔`jobs.agentSteps`↔WKF bundle 매핑표"는 아직 별도 산출물로 존재하지 않는다. 본 인벤토리가 그 1차 초안에 해당한다.

---

## 2. 백엔드 갭 (Overview §5.1 / GA-03 대응)

Overview §5.1의 7개 갭 항목을 현재 코드와 1:1 대조한다.

### 2.1 인입 결과 모델이 "문서 병합"에 치우침 — 🟡 부분

Main Agent는 `tool_merge`(기존 문서 병합 초안 합성) + `tool_verify_integrity` 중심이다. `create-new / enhance / skip / source-only`를 인입 단계의 1급 분기로 가진 로직은 **Main Agent에 없다**. `enhance/create/skip` 결정은 현재 **Curation Agent의 `tool_write_concept`에만** 존재한다(기존 published 유지보수 경로). → Overview가 원한 "신규 인입에도 create/enhance/skip 적용"은 미반영.

### 2.2 `KnowledgeCandidate` 1급 모델 부재 — ❌ 미구현

코드 전역 검색 결과 `KnowledgeCandidate` 식별자는 **존재하지 않는다**. 후보는 `documents.status`(DRAFT/PROCESSING/REVIEW)로 대체되고 있다. Overview가 요구한 사용자-facing 상태(`AI 정리됨`, `출처 확인됨`, `확인 필요`, `승인 필요`, `충돌 있음`)와 provenance 필드(`conversationQuote`, `speaker`, `createdFromConversation`, `needsSource`)는 스키마에 없다. `enrichment_proposals`는 후보 staging이 아니라 job 사후 gap 분석 결과물이다.

### 2.3 Conversation ingest 경로 부재 — ❌ 미구현

`apps/api/src/server.ts`에 conversation/meeting 인입 라우트가 **없다**(파일 업로드 `/api/ingest/file`, 외부 인입 `/api/external-ingest`, agent preview만 존재). learner는 trajectory 분석 기반 gap proposal에 가깝고, 대화/회의록/채팅에서 후보를 생성하는 명시적 API·워커는 없다.

### 2.4 OKF 링크 기반 지식 맵 산출물 부재 — ❌ 미구현

`# Relations`/KG는 완비됐으나, 일반 Markdown cross-link graph를 렌더하는 경로가 없다. `wkf` CLI에 `visualize` 서브커맨드가 **없고**(init/pull/push/reference/reindex/index/regenerate/mcp만 존재) `viz.html` 생성기·web graph API도 없다. `getDocumentConnections()`가 공유 엔티티 기반 관련 문서를 반환하지만 링크 그래프 추출은 아니다.

### 2.5 `wkf regenerate`가 product enrichment로 부족 — 🟡 부분

`packages/wkf/src/recipe.ts`의 `regenerateFromRecipe`는 `runPipeline` 콜백이 주입되면 사용하되, 기본값은 **deterministic placeholder markdown** 출력이다. 실제 enrichment draft agent와 연결되어 있지 않다. → Overview의 "recipe 재실행 → 후보 생성" 미충족.

### 2.6 승인 정책이 위험도 기준으로 단순화되지 않음 — 🟡 부분

`packages/wkf/src/policy.ts`의 `enforcePolicy('review', …)`는 **역할/타입 기반**(`review.approver_roles` 기본 `['OWNER','APPROVER']`, type override 예: REGULATION). 코드에 `needsReview`/`risk` 식별자가 **없다**. Overview가 원한 위험도 기반 `needsReview` 산정(정책성/출처없음/충돌/외부공개)은 미반영이며 승인은 워크플로 상태(REVIEW) + 역할 체크로만 동작.

### 2.7 출처·대화 provenance 세분화 부족 — 🟡 부분

`sourceRefs[].type`이 `upload|datasource|manual|api`까지는 구분하나, 대화 발화 근거(`conversationQuote`/`speaker`)와 "대화 기반 후보는 공식 지식과 다르게 취급" 정책은 모델·코드에 없다.

**백엔드 갭 요약**

| Overview §5.1 항목 | 상태 | 근거 |
| :--- | :--- | :--- |
| 1. 인입 결과 모델(병합 치우침) | 🟡 | merge/verify만, create/skip/source-only 분기 없음 |
| 2. KnowledgeCandidate 1급 모델 | ❌ | 식별자 부재, status로 대체 |
| 3. Conversation ingest 경로 | ❌ | 전용 API/worker 없음 |
| 4. OKF 링크 지식 맵 산출물 | ❌ | `wkf visualize`·viz·graph API 없음 |
| 5. wkf regenerate 제품화 | 🟡 | placeholder, agent 미연결 |
| 6. 위험도 기반 승인 | 🟡 | 역할/타입 기반, needsReview 부재 |
| 7. provenance 세분화 | 🟡 | 대화 발화 근거·정책 부재 |

---

## 3. 프런트엔드 갭 (Overview §5.2 / GA-04 대응)

### 3.1 인입/정리/승인 단순화 흐름 — 🟡 부분

`AddPage`(파일·수동·API)와 `ReviewPage`는 구현됐다. 그러나 검토는 **"AI가 정리한 후보" 중심**이 아니라 Layer1 Monaco diff + 레거시 카드가 병존하는 구조다. "넣기 → AI 정리 → 확인/승인" 단일 흐름으로 재설계되어 있지 않다.

### 3.2 대화에서 지식 저장 UX — ❌ 미구현

채팅/회의록 화면, "지식으로 저장 / 후보로 올리기 / 출처 필요" 액션이 **없다**. 백엔드 경로 부재(§2.3)와 일치.

### 3.3 Review 화면의 위험도 기반 triage — 🟡 부분

`ReviewCard`가 `reason` 필드와 certainty dots, change type을 표시하나, Overview가 원한 "왜 승인 필요인지"(정책성/출처없음/충돌/외부공개)를 위험 사유 카드로 분류해 보여주지는 않는다. Layer1은 여전히 raw diff 중심.

### 3.4 Knowledge Map 화면 — ❌ 미구현

graph/network 시각화, backlinks, type filter, layout switch 화면이 **없다**. `DocPage`의 Relations 탭은 삼중항 텍스트 목록 + 공유 엔티티 관련 문서일 뿐 시각 그래프가 아니다. `sources/rules/history`는 stub.

### 3.5 출처·신뢰 라벨 일관성 — 🟡 부분

KB 카드에 freshness 상태점(`latest`✓ / `needs_update`⚠ / `conflict`●)이 있고 review 카드에 status badge/certainty가 있으나, Overview가 정의한 `AI 정리됨 / 출처 확인됨 / 공식 지식 / 확인 필요 / 승인 필요 / 충돌 있음` **명시 라벨 텍스트로는 일관 표시되지 않는다**(freshness가 근사 프록시). source level(L1~L4)은 `format.tsx`에 정의되나 답변·KB 카드에 노출되지 않음.

### 3.6 일반 사용자에 OKF/WKF 비노출 — ✅ 대체로 충족

기본 UI는 한국어 라벨(주제/상태/충돌 등) 사용. WKF/OKF·pipeline·tool 용어는 **AgentPreviewPage(OWNER)·DevPanel(슈퍼어드민) 디버그 화면에만** 노출. 이 항목은 목표에 부합.

### 3.7 Ask/Q&A 화면 — ❌ 미구현 (Overview에 암묵 포함)

`POST /api/ask`는 존재하지만 이를 호출하는 **프런트 Q&A 페이지가 없다**. 또한 `/api/ask`는 SSE로 `{ answer }` 문자열만 반환하며 **출처/citation/신뢰 상태를 포함하지 않는다**(`apps/api/src/server.ts` L821~). → Overview §3.4 "답변에 라벨/출처 표시" 미충족.

**프런트엔드 갭 요약**

| Overview §5.2 항목 | 상태 | 근거 |
| :--- | :--- | :--- |
| 1. 인입/정리/승인 단순 흐름 | 🟡 | Add/Review 있으나 후보 중심 단일 흐름 아님 |
| 2. 대화에서 저장 UX | ❌ | 없음 |
| 3. 위험도 기반 triage | 🟡 | reason 표시, 위험 분류 카드 없음 |
| 4. Knowledge Map 화면 | ❌ | 시각 그래프 없음, Relations는 텍스트 목록 |
| 5. 신뢰 라벨 일관성 | 🟡 | freshness 프록시만, 명시 라벨 부재 |
| 6. OKF/WKF 비노출 | ✅ | 디버그 화면에만 노출 |
| (7.) Ask/Q&A + 출처 표시 | ❌ | 프런트 페이지 없음, 답변에 출처 없음 |

---

## 4. GA-02 / GA-05 상태

### 4.1 GA-02 Target Product Flow Contract — ❌

Overview가 산출물로 요구한 다음 4종이 코드·문서 어디에도 정의돼 있지 않다: `KnowledgeCandidate` 상태 기계, 위험도 기반 `needsReview` 규칙, 대화 기반 후보 provenance 규칙, 자동 게시 가능 조건. 현 `documentStatuses`(7개)는 내부 파이프라인 상태이지 §2.2 표의 사용자-facing 지식화 상태와 매핑되어 있지 않다. **이 contract 확정이 T1(Candidate 모델) PR의 선행 조건이다.**

### 4.2 GA-05 Migration & Simplification Plan — ❌

"유지/숨길/이름 바꿀/제거 후보" 목록, PR 단위 순서, 회귀 테스트·acceptance gate가 아직 없다. 다만 §3.6에서 확인되듯 OKF/WKF 용어 은닉은 이미 상당 부분 달성되어 있어, simplification의 출발점은 양호하다.

---

## 5. 종합: 방향성 대비 변경사항 판정

Overview가 제시한 7개 PR 트랙(§7) 기준 현재 위치:

| 트랙 | 주제 | 현재 상태 | 비고 |
| :--- | :--- | :--- | :--- |
| T1 | Candidate 모델 | ❌ 미착수 | `KnowledgeCandidate`·상태기계·신뢰라벨 전무 (GA-02 선행) |
| T2 | Enrichment Draft Agent | 🟡 엔진 존재 | Main Agent 있으나 create/skip/source-only·recipe 연결 미반영 |
| T3 | Conversation Ingest | ❌ 미착수 | API·worker·UX 없음, learner만 인접 |
| T4 | Review Triage | 🟡 부분 | 검토 UI/정책 엔진 있으나 위험도 기반 라우팅 아님 |
| T5 | Knowledge Map | ❌ 미착수 | KG는 있으나 Markdown link map·visualize 없음 |
| T6 | Discovery Trust | 🟡 부분 | hybrid 검색·/api/ask 있으나 답변 출처/신뢰 미표시 |
| T7 | Simplification Cleanup | 🟡 부분 | OKF/WKF 비노출은 상당 달성, 정식 정리 미작성 |

**판정.** 지난 작업으로 *엔진 계층*(인입·큐레이션·KG·검색·정책·검토 UI)은 목표 방향과 모순 없이 잘 갖춰졌다. 반면 Overview의 핵심 차별점인 *제품 표면 계층*(후보 모델·위험도 승인·대화 인입·지식 맵·신뢰 라벨)은 대부분 미착수다. 즉 **현재 변경사항은 방향성과 충돌하지 않으며, "기반은 섰고 제품 흐름 재정렬은 이제 시작" 단계**로 정리된다.

---

## 6. 권고 다음 단계

1. **GA-02 contract부터 확정** — `KnowledgeCandidate` 상태 기계와 위험도 기반 `needsReview` 규칙을 문서로 먼저 못 박는다(T1·T4의 공통 선행). 현 `documentStatuses` ↔ 사용자-facing 상태 매핑표를 함께 만든다.
2. **T1을 첫 PR로** — 후보 모델/provenance 스키마 + 신뢰 라벨 UI. 이후 트랙들이 이 모델에 의존한다.
3. **저비용 조기 확보 가능 항목** — `/api/ask` 응답에 출처/신뢰 상태를 실어 보내고(T6 일부), `wkf visualize`로 Markdown 링크 맵 v1(T5)을 빠르게 PoC화하면 고객 신뢰 데모에 즉시 활용 가능.
4. **GA-05 정리 목록 작성** — OKF/WKF 용어는 이미 디버그 화면에 격리돼 있으므로, "리네임/숨김" 위주의 가벼운 cleanup 범위로 시작한다.

---

## 7. 검증 메모

본 문서의 사실 주장은 코드 직접 확인으로 교차검증했다:

- `documentStatuses` enum 7종 — `packages/shared/src/index.ts` L4~11 확인.
- `KnowledgeCandidate` 식별자 부재 — 전역 grep 결과 0건.
- conversation/meeting 인입 라우트 부재 — `apps/api/src/server.ts` grep 0건.
- `wkf visualize`/viz.html 부재 — `packages/wkf/src/cli.ts` grep 0건.
- `/api/ask` 응답이 `{ answer }`만 반환(출처/신뢰 없음) — `apps/api/src/server.ts` L821~845 확인.
- `needsReview`/`risk` 부재 — `packages/wkf/src/policy.ts` grep 0건.
