# Phase 3 — LNB(사이드바) + 문서 트리

> PRD 🚩 Phase 3: *목업 `aside.sb`와 `renderTree` 재현 — 네비게이션·뱃지·카테고리 트리·검색.*
> *The fixed navy sidebar: nav, live badges, category→doc tree, quick search.*

목표: 좌측 고정 네이비 LNB와 그 안의 문서 트리를 목업과 동일하게 구현한다. 가장 단순한 읽기 중심 화면으로 셸·data 훅·스토어 패턴을 검증한다.

참조 목업: `aside.sb`(905~939줄), `renderTree`/`toggleTreeCat`/`filterTree`(1519~1564줄), `go`(1501줄).

---

## 1. 컴포넌트 구성

```
apps/web/src/components/lnb/
  Lnb.tsx            // aside.sb 컨테이너
  NavItem.tsx        // .ni (아이콘·라벨·뱃지)
  DocumentTree.tsx   // tree-search + #doc-tree
  TreeCategory.tsx   // tree-cat 행(캐럿·색점·카운트) + tree-docs
```

---

## 2. LNB 레이아웃 (`Lnb.tsx`)

목업 구조 그대로:

| 영역 | 목업 클래스 | 내용 |
| :--- | :--- | :--- |
| 로고 | `.sb-logo` | `V WIKI`(em=purple-300) + 햄버거 SVG 마크 |
| 워크스페이스 | `.sb-workspace` | `총` 아이콘 + `총무팀` + `▾` (정적; 부서 전환은 향후) |
| 기본 nav | `.ni` | 홈(`⌂`) / 검토(`◰` + 뱃지) / 조직 지식(`◈` + 뱃지 88) |
| 시스템 섹션 | `.sb-sec-label` + `.ni` | 데이터 소스/처리 규칙/변경 이력/직접 추가 → **스텁 nav**(클릭 시 "준비 중") |
| 문서 트리 | `.sb-sec-label` + `.tree-search` + `#doc-tree` | 검색 입력 + 카테고리 트리 |
| 사용자 푸터 | `.sb-user` | `이` 아바타 + `이지수 (총무팀장)` + `지식 관리자` |

### 🛠️ 3.1 `NavItem` & 활성 표시

```tsx
// activePage로 .ni.on, onClick으로 go(page)
<NavItem page="review" icon="◰" label="검토" badge={pendingCount} badgeClass="nb-red" />
```

- **검토 뱃지** = 미완료 검토수 + 멀티소스 그룹수. `review` 슬라이스 + `useReviewBoard()`/`useMultiSource()` 카운트를 구독해 **라이브** 갱신(목업이 `renderHome`/`renderReview` 양쪽에서 `nav-review-badge`를 갱신하던 것을 단일 셀렉터로 대체).
- **조직 지식 뱃지** = published(지식) 총수(`useTreeCategories()` 또는 `useKnowledgeItems`의 total).

---

## 3. 문서 트리 (카테고리 → 문서)

목업 `renderTree`는 `TOPICS`(미분류 제외) 아래 문서를 `cat` 기준으로 묶는다. data는 `useTreeCategories()`(Phase 1 `/api/tree/categories`).

### 🛠️ 3.2 `TreeCategory` 렌더

```tsx
// 각 카테고리: 캐럿(open 회전) + 색점(CAT_COLORS) + 이름 + 문서수
// 펼침 시 문서 행: ▫ 아이콘 + 제목 + (modCount>0 ? 주황 업데이트 점)
```

| 요소 | 목업 | 구현 |
| :--- | :--- | :--- |
| 캐럿 회전 | `.tree-caret.open` | `treeOpen[catId]` 스토어 상태 |
| 카테고리 색 | `CAT_COLORS[name]` | `lib/format.ts` |
| 문서수 | `docs.length` | 카테고리별 카운트 |
| 업데이트 점 | `d.upd>0` → `.tdot-upd` | `item.modCount > 0` |
| 활성 강조 | `curDoc.cat===name` / `curDoc.id===d.id` | `selectedCategory`/`selectedDocId` |

### 🛠️ 3.3 상호작용

- **카테고리 행 클릭**(`toggleTreeCat`): `treeOpen[id]` 토글 **그리고** 펼칠 때 `openCategory(name)` → KB 통합 보기(Phase 5). 닫을 땐 페이지 전환 안 함.
- **문서 행 클릭**: `openDoc(id)` → 단일 문서(Phase 5) + 트리의 해당 카테고리 자동 확장(`openDoc`가 `treeOpen[cat]=true`).
- **검색**(`filterTree`): 제어 입력. 문서명 부분일치 필터 + 매칭 카테고리 자동 확장. **목업의 DOM `style.display` 조작 대신** 파생 필터(필터된 리스트만 렌더). 카테고리명 매칭 시 해당 카테고리 전체 노출.

> ⚠️ Phase 3 시점엔 KB(Phase 5)·단일 문서가 아직 없을 수 있다. `openCategory`/`openDoc`는 스토어 액션을 디스패치하고 `activePage`만 전환(목적지 화면은 빈/스텁) — 클릭-스루 완전 검증은 Phase 5 착지 후.

---

## 4. ✅ 완료 기준 (Definition of Done)

- [ ] LNB가 목업과 시각적으로 일치(네이비·로고·워크스페이스·nav·시스템 섹션·사용자 푸터).
- [ ] nav 클릭으로 `activePage` 전환 + `.ni.on` 활성 표시. 시스템 메뉴는 "준비 중" 스텁.
- [ ] 검토 뱃지 = 검토수+멀티소스수, 조직 지식 뱃지 = 지식 총수 (data 훅 구독, 라이브).
- [ ] 문서 트리가 카테고리별로 색점·문서수와 함께 렌더, `modCount>0` 문서에 주황 업데이트 점.
- [ ] 카테고리 펼침/접힘(`treeOpen`), 문서/카테고리 클릭이 `openDoc`/`openCategory` 디스패치.
- [ ] 검색 입력이 문서명 필터 + 매칭 카테고리 자동 확장(파생 필터).
- [ ] `pnpm --filter @wf/web typecheck` 통과.

> ✅ 게이트 통과 시 **Phase 4(홈)**로 진행. 트리 클릭-스루(통합 보기·단일 문서 진입)는 Phase 5에서 최종 검증.
> ⚠️ 실 n-depth 트리(`buildTree`)는 이 화면에서 미사용 — "폴더 렌즈" seam으로 보존.
