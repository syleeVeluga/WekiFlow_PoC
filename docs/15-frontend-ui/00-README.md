# 15. 프론트엔드 UI — V WIKI 디자인 단계별 적용 (개요 & 인덱스)

> PRD 🚩 Frontend UI: *V WIKI 정적 목업(`docs/Design Reference/v-wiki.html`)을 풀스택으로 구현 — 데이터 계약 → API → 화면.*
> *Bring the V WIKI mockup to life across 5+1 UI areas: data model, API, then screens.*

이 폴더는 디자인 레퍼런스(`docs/Design Reference/v-wiki.html`, 2720줄, "V WIKI — 회사의 기억을 운영하는 AI")의 **사용자 시나리오·레이아웃·스타일**을 기준으로 **LNB·홈·검토·조직 지식·문서 트리 + 단일 문서 화면**을 구현하기 위한 **단계별 기능 적용 계획**이다. 각 Phase 문서는 기존 `docs/NN-phase-N-*.md` house style을 따르며, **완료 기준(DoD) 게이트**로 다음 단계를 연다.

---

## 1. 컨텍스트 (목업 vs 현재 격차)

| 측면 | 목업 (`v-wiki.html`) | 현재 (`apps/web`, Phase 1) |
| :--- | :--- | :--- |
| 셸 | 고정 네이비 LNB(256px) + 페이지 전환(`go(p)`) | 단일 화면 — 사이드바에 4컴포넌트 스택, 라우터 없음 |
| 스타일 | 디자인 토큰(`:root`) + 영역별 CSS | 토큰 없는 평문 `styles.css` 256줄 |
| 화면 | 홈·검토(멀티소스)·조직 지식·문서 트리·단일 문서 + 시스템 4종 | 트리/검토목록/지식목록/인입폼(단순 버튼 리스트) |
| 데이터 | KB_ALL(~88) · TOPICS · RV_ALL · MS_GROUPS · AI_TAG_SUGGEST · HIST_ALL (손작성) | `DocumentDTO`/`TreeNode`만 — 부서·카테고리·AI태그·참조수·확실성·우선순위·변경유형·소스채널·멀티소스 **전무** |

목표: 위 격차를 **풀스택**으로 메운다 — 부족 데이터를 `packages/shared` 타입 + MongoDB 컬렉션 + 신규 API로 실제 생산하고, `apps/web`을 목업과 동일한 UX로 재구축한다.

---

## 2. 범위 (Scope)

**포함 5+1 영역**

| # | 영역 | 목업 페이지 | Phase 문서 |
| :--- | :--- | :--- | :--- |
| ① | LNB 사이드바 (사용자 표기 "LMB") | `aside.sb` | [04](./04-phase-3-lnb-tree.md) |
| ② | 홈 | `pg-home` | [05](./05-phase-4-home.md) |
| ③ | 검토 (+멀티소스) | `pg-review` | [07](./07-phase-6-review.md) |
| ④ | 조직 지식 | `pg-kb` | [06](./06-phase-5-org-knowledge.md) |
| ⑤ | 문서 트리 (LNB 내) | `renderTree` | [04](./04-phase-3-lnb-tree.md) |
| ⑥ | 단일 문서 | `pg-doc` | [06](./06-phase-5-org-knowledge.md) |

**제외**: 데이터 소스(`pg-sources`)·처리 규칙(`pg-rules`)·변경 이력(`pg-history`)·직접 추가(`pg-add`)·소스 연결 위저드. LNB에는 시스템 섹션 nav를 **시각적으로 노출**하되, 클릭은 "준비 중" 스텁 페이지로 처리한다.

---

## 3. 용어집 (Glossary)

| 용어 | 의미 |
| :--- | :--- |
| **LNB** | Left Navigation Bar — 좌측 고정 네이비 사이드바 (목업 `.sb`). 사용자가 "LMB"로 표기한 대상. |
| **검토(Review)** | 감지된 변화를 사람이 승인/반려하는 Human-in-the-loop 큐. 우선순위 P0/P1/P2. |
| **멀티소스(Multi-source)** | 동일 주제가 여러 채널에서 감지될 때의 통합 검토. 타입 A(동일)/B(유사·버전선택)/C(상충·자동해결불가)/D(선택적). |
| **소스 권위(Source Authority)** | 채널 신뢰 등급 L1>L2>L3>L4 (공식 공지 > 비공식 문의 등). |
| **신선도(Freshness)** | 지식 항목의 콘텐츠 상태 `latest`/`needs_update`/`conflict`. 문서 라이프사이클(`DocumentStatus`)과 **별개 축**. |
| **통합 보기(Integrated view)** | 한 카테고리의 하위 문서를 한 페이지에서 스크롤 열람(`openCategoryView`). |
| **다이제스트(Digest)** | 홈의 "오늘, 조직이 새로 배운 것" 내러티브(충돌/신규/업데이트). |
| **부서(Department)** | 총무팀/인사팀/IT팀 등 워크스페이스/담당 조직. |

---

## 4. 핵심 아키텍처 결정

1. **타입은 `packages/shared`에 추가**(서버·워커·프론트 공유), 색상/아이콘 맵·UI 런타임 상태는 `apps/web`에. `packages/shared/src/wiki/`(enums + Zod + `z.infer`) 신설·재export. 기존 `DocumentDTO`/`TreeNode`는 **불변(additive only)**.
2. **`KnowledgeFreshness` ≠ `DocumentStatus`** — 의미 축이 다르므로 enum 분리. `KnowledgeItem.documentId` join 키로 연결.
3. **목업 데이터는 DB 시드로 이식** — 타입드 시드 스크립트로 MongoDB에 멱등 적재, 프론트는 신규 API 소비.
4. **react-router 미도입** — 목업 `go(p)`를 Zustand `activePage` + 조건부 렌더로 미러.
5. **디자인 토큰 CSS 레이어** — 목업 `:root`를 `styles/tokens.css`로 이식, 영역별 CSS 분할. 전역 클래스명 유지(기계적 포팅). CSS Modules/CSS-in-JS 미도입.
6. **문서 트리 = 카테고리→문서 2단 그룹핑**(목업 충실도 우선). 백엔드 n-depth `parentId` 트리(`buildTree`)는 향후 "폴더 렌즈" seam으로 유지.
7. **재사용 우선** — `canApprove`/`normalizeEntityName`/`DocumentStatus`/`buildTree`(`packages/shared`·`apps/web/src/lib`), `request<T>`/`ApiError`/`queryKeys`/`WekiFlowStore` 패턴(`apps/api`·`apps/web/src/api`). 중복 구현 금지.

---

## 5. 데이터 분류 (A/B/C) — 영역별 필드 인벤토리 요약

분류: **(A)** 기존 API/DTO로 즉시 가용 · **(B)** 클라이언트/서버 어댑터로 파생 · **(C)** 백엔드 신규 생산 필요.

| 영역 | (A) 가용 | (B) 파생 | (C) 신규 생산 |
| :--- | :--- | :--- | :--- |
| LNB | nav 라우팅, 사용자/역할 | 조직지식 badge(=published 수) | 검토 badge(검토수+멀티소스), 워크스페이스(부서) |
| 홈 | — | — | 상태바 지표, 다이제스트, 자동처리율, 커버리지, 최근활동 |
| 검토 | (문서 제목·본문 연결) | dp(작성자→부서), ex.content(본문 슬라이스) | pri·ct·t·thread·reason·멀티소스·소스권위 |
| 조직 지식 | id·tp(title)·full(본문) | pv(요약)·by(작성자)·dt(날짜)·upd(version−1) | dp·cat·status(freshness)·uses·aiTags·AI태그제안·ori/chg |
| 문서 트리 | 실 트리 구조(seam) | 업데이트 점(version>1) | 카테고리 그룹핑·카운트 |
| 단일 문서 | 본문(`contentMarkdown`) | 소스 라벨 | 탭 메타(연결관계·변경기록)·챗봇 플래그 |

> 풀스택 범위이므로 **(C)는 Phase 0/1에서 컬렉션·엔드포인트로 실제 구현**한다. (A)는 기존 엔드포인트를 seam으로 유지한다.

---

## 6. Phase 로드맵 & 게이트

| Phase | 산출물 | 게이트(DoD) | 의존 | 상태 |
| :--- | :--- | :--- | :--- | :--- |
| **0** 데이터 모델·타입 | `@wf/shared/wiki` 타입 + Mongo 컬렉션 + 시드 | [01 §4](./01-phase-0-data-model.md) | — | ⬜ 계획 |
| **1** API 엔드포인트 | 조회·변경 라우트 + store 메서드 | [02 §4](./02-phase-1-api.md) | 0 | ⬜ 계획 |
| **2** FE 기반 | 토큰·셸·라우팅·스토어·data 훅 | [03 §6](./03-phase-2-foundation.md) | 0,1 | ⬜ 계획 |
| **3** LNB + 문서 트리 | `lnb/*` 컴포넌트 | [04 §4](./04-phase-3-lnb-tree.md) | 2 | ⬜ 계획 |
| **4** 홈 | `home/*` 위젯 | [05 §4](./05-phase-4-home.md) | 2,3 | ⬜ 계획 |
| **5** 조직 지식 + 단일 문서 | `kb/*` + `doc/*` + 모달 | [06 §5](./06-phase-5-org-knowledge.md) | 2,3 | ⬜ 계획 |
| **6** 검토 + 멀티소스 | `review/*` | [07 §5](./07-phase-6-review.md) | 2 | ⬜ 계획 |

```
Phase 0 (데이터·타입) ─► Phase 1 (API) ─► Phase 2 (FE 기반)
                                              ├─► Phase 3 (LNB+트리)
                                              ├─► Phase 4 (홈)
                                              ├─► Phase 5 (조직지식+단일문서)
                                              └─► Phase 6 (검토+멀티소스)
```

순서 근거: 데이터·계약(0)→API(1)→FE 기반(2)이 선행. 이후 가장 단순한 읽기뷰(트리→홈)로 셸·data 훅 패턴을 검증한 뒤, 클릭 목적지인 KB/단일문서(5), 최고 난도 멀티소스(6) 순. 트리 클릭-스루의 완전 검증은 Phase 5 착지 후 가능(Phase 3에서 액션은 스텁 디스패치).

---

## 7. 문서 트리 결정 (카테고리 그룹핑 vs 실 트리)

목업의 `renderTree()`는 LNB 트리를 `TOPICS`(카테고리) 아래 `KB_ALL`을 `k.cat === cat.name`으로 묶는 **2단 카테고리→문서** 구조로 그린다. 반면 백엔드 `TreeNode`/`buildTree`는 `parentId` 기반 **n-depth 폴더 트리**다.

- **결정**: LNB 트리는 **목업 충실도 우선 = 카테고리 그룹핑**으로 구현(사용자 지시 = 목업 사용 시나리오 재현).
- **Seam**: 실 n-depth 트리(`buildTree` + `/api/tree`)는 보존하고, 향후 "폴더 렌즈"(보기 전환) 또는 카테고리 ↔ 문서 매핑 소스로 재활용. `KnowledgeItem.documentId`가 두 모델의 join 키다.

---

## 8. 문서 인덱스

- [01-phase-0-data-model.md](./01-phase-0-data-model.md) — 데이터 모델 & 타입 (백엔드 기반)
- [02-phase-1-api.md](./02-phase-1-api.md) — API 엔드포인트 (백엔드)
- [03-phase-2-foundation.md](./03-phase-2-foundation.md) — 프론트엔드 기반 (토큰·셸·라우팅·스토어·data 훅)
- [04-phase-3-lnb-tree.md](./04-phase-3-lnb-tree.md) — LNB + 문서 트리
- [05-phase-4-home.md](./05-phase-4-home.md) — 홈 대시보드
- [06-phase-5-org-knowledge.md](./06-phase-5-org-knowledge.md) — 조직 지식 + 단일 문서
- [07-phase-6-review.md](./07-phase-6-review.md) — 검토 + 멀티소스

> ⚠️ 이 폴더의 산출물은 **계획 문서**다. 실제 코드(타입·API·컴포넌트) 구현은 각 Phase 문서의 DoD를 게이트 삼아 후속 작업으로 진행한다.
