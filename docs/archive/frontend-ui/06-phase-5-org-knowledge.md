# Phase 5 — 조직 지식 + 단일 문서

> PRD 🚩 Phase 5: *목업 `pg-kb`(필터·그리드·카테고리·통합보기) + `pg-doc`(단일 문서) + AI태그/카테고리 모달.*
> *The knowledge base: faceted filters, grid/category views, integrated view, single doc, and modals.*

목표: 조직 지식 탐색·열람·편집의 전체 흐름. 트리·홈 다이제스트의 클릭 목적지(`openDoc`/`openCategory`)가 여기로 착지한다.

참조 목업: `pg-kb`(1009~1053줄), `renderKBSidebar`/`kbFilteredItems`/`renderKB`/`kbCardHTML`/`renderCatView`/`openCategoryView`(1660~1824줄), `pg-doc`/`openDoc`/`renderDoc`(1055~1060, 1826~1903줄), 모달(`openCatManager`/`openAIReview` 등 2646~2696줄).

---

## 1. 컴포넌트 구성

```
apps/web/src/components/kb/
  KbPage.tsx              // wiki-shell (필터 사이드바 + 메인)
  KbFilterSidebar.tsx     // wf-people / wf-topics / wf-tags / wf-status
  KbTopbar.tsx            // 검색 + 카운트 + 뷰 토글 + 정렬 + 직접추가(스텁)
  KnowledgeCard.tsx       // kbCardHTML
  KbGrid.tsx              // 그리드 + AI태그 배너
  CategoryView.tsx        // 통합 보기(openCategoryView)
  AiTagReviewModal.tsx    // AI 태그 제안 검토
  CategoryManagerModal.tsx// 주제 관리(추가/삭제)
apps/web/src/components/doc/
  DocPage.tsx             // pg-doc: 툴바 + 본문
  DocToolbar.tsx          // 탭(편집/소스/연결관계/변경기록) + 챗봇 토글
  DocBody.tsx             // fmtBody 읽기 + textarea 편집
```

데이터: `useKnowledgeItems(q)` / `useKnowledgeItem(id)` / `useTopics()` / `useAiTagSuggestions()` + mutations `usePatchKnowledge` / `useTopicMutations` / `useAiTagMutations`.

---

## 2. 조직 지식 (KB)

### 🛠️ 5.1 필터 사이드바 (`KbFilterSidebar`)

목업 `renderKBSidebar` 4섹션:

| 섹션 | 목업 | 동작 |
| :--- | :--- | :--- |
| 담당자 | `KB_PEOPLE` | 아바타+이름+건수, 선택 시 `kb.personF` |
| 주제 분류 | `TOPICS`(system+user) | 색점+이름+건수, user는 `✎`, `미분류` 행, 헤더 "관리"→`CategoryManagerModal` |
| AI 자동 분류 태그 | `aiTags` 상위 12 | `#태그` 토글 필터(`kb.tagF`), "AI 자동 분류는 태그로 구분" 안내 |
| 상태 | `KB_STATUS` | 전체/✓최신/⚠업데이트 필요/●충돌 → `kb.statusF` |

> ⚠️ 주제(카테고리)와 AI 태그는 **다른 축**이다. `kbSetTopic`는 `tagF`를 비우고, `kbSetTag`는 `topicF`를 'all'로 — 목업 동작 보존.

### 🛠️ 5.2 탑바 & 필터링 (`KbTopbar` + `kbFilteredItems`)

- 검색(`kb.query`, 라이브) · 카운트 `${total}개 중 ${n}개` · 뷰 토글(그리드|카테고리별) · 정렬(`참조 많은순`/`최근 수정순`/`가나다순`) · `+ 직접 추가`(스텁).
- 필터 합성 로직(`kbFilteredItems` 이식): 담당자(작성자 or 부서 폴백 맵) ∧ 주제 ∧ AI태그 ∧ 상태 ∧ 검색어(제목/요약/태그). 정렬 3종.

> ⚠️ 목업의 person→dept 폴백 맵(`{'이지수':'총무팀',…}`)을 그대로 유지. 검색 매칭은 `normalizeEntityName`(shared) 재사용 가능.

### 🛠️ 5.3 그리드 & 카드 (`KbGrid` / `KnowledgeCard`)

- `kbCardHTML` 재현: 제목 + 상태 점(ok/upd/cf) + 요약 + AI태그 ≤3(+N) + 카테고리 칩(tint) + `수정 N` + 작성자 아바타 + `참조 N`. 카드 클릭 → `openDoc(id)`.
- 그리드 상단 **AI 태그 검토 배너**: `useAiTagSuggestions().length>0`이면 노출 → `AiTagReviewModal`.

### 🛠️ 5.4 카테고리별 뷰 & 통합 보기

- **카테고리별 뷰**(`renderCatView`): 카테고리 그룹 헤더(색점+이름+건수+"통합 보기 →") + 그리드. `미분류`는 경고 문구와 함께 별도 그룹.
- **통합 보기**(`openCategoryView` → `CategoryView`): `kb` 페이지의 서브 모드(`selectedCategory`). 카테고리 전체 문서를 `fmtBody`로 펼쳐 스크롤, 각 문서 "단일 페이지 열기 ↗"(`openDoc`), 상단 "← 위키 홈으로"(`setKb({mode:'grid'})`). 트리 카테고리 클릭·그리드 헤더·문서 뒤로가기에서 진입.

---

## 3. 단일 문서 (`DocPage`)

목업 `openDoc`/`renderDoc`. 트리·KB 카드·다이제스트 entity에서 진입.

### 🛠️ 5.5 툴바 & 탭 (`DocToolbar`)

- 탭: **편집** / 소스 / 연결 관계 / 변경 기록 (`docTab`). 챗봇 토글(`toggleChatbot` → 토스트).
- 뒤로가기 → `openCategoryView(doc.category)`.

### 🛠️ 5.6 본문 & 편집 (`DocBody`)

- **편집 탭**: `src`에 'Slack' 포함 시 "AI 학습" 박스 노출. 기본은 `fmtBody(contentMarkdown)` 읽기 뷰 + "편집하기" → `<textarea>` + 저장/취소.
- **저장**(`saveDoc`): `usePatchKnowledge` → `PATCH /api/knowledge/:id` → `version`/`modCount` bump. 성공 시 React Query invalidate → **트리 업데이트 점 갱신**(`modCount>0`)·KB 카드 `수정 N` 갱신.
- 소스/연결 관계/변경 기록 탭은 `renderDoc`의 해당 패널(provenance·관련 문서·`ori`/`chg` 타임라인) 렌더.

> ⚠️ 단일 문서 편집은 목업처럼 **평문 `<textarea>`** 로 구현(파리티·단순성 우선). 기존 `HybridEditor`/BlockNote/Monaco 스왑은 후속 과제(컴포넌트는 보존). `fmtBody`는 신뢰된 시드 본문에 한해 사용.

---

## 4. 모달

### 🛠️ 5.7 AI 태그 검토 (`AiTagReviewModal`)

`AI_TAG_SUGGEST` 목록 + 선택. 승인(`approveAITags`) → 문서 `aiTags`에 태그 push + 제안 제거(`useAiTagMutations` → `/api/ai-tag-suggestions/:id/approve`), 반려 → 제안 제거. 닫으면 배너 카운트 갱신.

### 🛠️ 5.8 카테고리 관리 (`CategoryManagerModal`)

사용자 주제 추가(`addCatFromModal` → `POST /api/topics`) / 삭제(`delCat` → `DELETE /api/topics/:id`, **system 불가**, 삭제 시 문서 `미분류` 재배정). 변경 후 필터 사이드바·트리 invalidate.

> ⚠️ 모든 변경은 `data/hooks` mutation으로 서버 반영 + 관련 쿼리 invalidate. 목업의 전역 배열 직접 변이 패턴을 그대로 옮기지 말 것(React 재렌더·서버 정합).

---

## 5. ✅ 완료 기준 (Definition of Done)

- [x] 그리드/카드가 목업과 일치(상태 점·AI태그·카테고리 칩·작성자·참조수).
- [x] 4필터(담당자·주제·AI태그·상태) + 검색 + 정렬 3종 + 뷰 토글이 **합성** 동작(교차 필터).
- [x] AI 태그 배너 + 모달 승인/반려가 문서 `aiTags`·제안 카운트를 갱신.
- [x] 카테고리 관리 추가/삭제 동작 + 사용자 주제 삭제 시 `미분류` 재배정.
- [x] 카테고리별 뷰·통합 보기가 카테고리 전체 문서를 스크롤 렌더, 진입/복귀 동작.
- [x] 단일 문서가 트리·카드·다이제스트에서 진입, 탭 전환, 편집→저장 시 **트리 업데이트 점·카드 수정수 갱신**, 챗봇 토글 토스트.
- [x] 트리 클릭-스루(카테고리→통합보기, 문서→단일문서)가 Phase 3와 연결되어 완전 동작.
- [x] `pnpm --filter @wf/web typecheck` 통과.

> ✅ 게이트 통과 시 **Phase 6(검토 + 멀티소스)**로 진행 — 마지막 최난도 단계.
> ⚠️ Phase 3에서 스텁이던 트리 클릭-스루를 여기서 최종 검증한다.
