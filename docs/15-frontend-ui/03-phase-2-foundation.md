# Phase 2 — 프론트엔드 기반 (토큰 · 셸 · 라우팅 · 스토어 · data 훅)

> PRD 🚩 Phase 2: *목업 디자인 토큰·고정 LNB 셸·`go()` 라우팅·Zustand 슬라이스·React Query data 훅 골격.*
> *Design tokens + fixed-LNB shell + state-based routing + store slices + data hooks scaffold.*

목표: Phase 3~6 화면이 올라탈 **공통 기반**을 만든다. 목업의 시각·전환·상태·데이터 접근 패턴을 한 번에 정착시킨다.

---

## 1. 디자인 토큰 CSS 레이어

기존 `apps/web/src/styles.css`(토큰 없는 256줄)는 **폐기**한다. 목업 `:root`(9~37줄)를 그대로 이식.

```
apps/web/src/styles/
  index.css      // @import 순서: tokens → layout → 영역별
  tokens.css     // :root 토큰 + 전역 리셋 + body/html (목업 9~39줄)
  layout.css     // .sb, .main, .pg/.pg.on, .topbar, .btn*, .badge*
  home.css  review.css  kb.css  doc.css  tree.css   // 영역별(각 Phase에서 채움)
```

### 🛠️ 2.1 토큰 이식 (`tokens.css`)

```css
:root{
  --primary:#5645d4;--primary-pressed:#4534b3;--on-primary:#fff;
  --navy:#0a1530;--navy-deep:#070f24; /* …목업 전체 토큰… */
  --sw:256px;--tree-w:280px;
  --ff:"Inter",-apple-system,system-ui,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;
  --sh-sm:0 1px 2px rgba(15,15,15,.06); /* … */
}
html{font-size:14px}
body{font-family:var(--ff);background:var(--surface);color:var(--ink);display:flex;min-height:100vh;overflow:hidden}
```

> ⚠️ 목업의 **전역 클래스명을 그대로 유지**(`.sb`,`.ni`,`.pg`,`.card`,`.btn-primary`…). CSS Modules/CSS-in-JS 도입 금지 — 도입 시 모든 클래스 rename이 강제되어 1:1 시각 포팅이 깨진다. 동적 색(카테고리 tint·확실성 색·아바타 색)은 목업처럼 inline `style`로 처리.
> ⚠️ Inter 폰트 `<link>`를 `apps/web/index.html`에 추가(목업 7줄). `main.tsx`에서 `import './styles/index.css'`.

---

## 2. 셸 & 라우팅

### 🛠️ 2.2 `App.tsx` 재작성

기존 4-패널 스택 사이드바를 폐기하고 목업 셸로 교체.

```tsx
// apps/web/src/App.tsx
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="app">                 {/* body: flex row */}
        <Lnb />                              {/* 고정 네이비 사이드바 width:var(--sw) */}
        <main className="main">              {/* margin-left:var(--sw) */}
          <ActivePage />                     {/* activePage로 조건부 렌더 */}
        </main>
        <ReviewDetailPanel />                {/* dp-ov 오버레이(검토) */}
        <Toast />                            {/* 전역 토스트 */}
      </div>
    </QueryClientProvider>
  );
}

function ActivePage() {
  const page = useUiStore((s) => s.activePage);
  switch (page) {
    case 'home':   return <HomePage />;
    case 'review': return <ReviewPage />;
    case 'kb':     return <KbPage />;        // 통합 보기 포함(selectedCategory)
    case 'doc':    return <DocPage />;
    default:       return <StubPage page={page} />;  // 시스템 메뉴 "준비 중"
  }
}
```

> ⚠️ `QueryClientProvider`는 유지(data 훅의 seam). 시스템 nav(`sources`/`rules`/`history`/`add`)는 `StubPage`("준비 중")로만 처리 — 범위 외.

### 🛠️ 2.3 페이지 식별자

`'home' | 'review' | 'kb' | 'doc'`(범위 내) + 시스템 스텁. 목업 `go(p)`의 페이지 토글 + per-page render 부수효과를 **선언적 재렌더**로 대체.

---

## 3. Zustand 스토어 확장 (`store.ts`)

기존 `{ selectedDocId, role, select, setRole }`에 슬라이스 추가. 교차 화면 상태는 스토어, 일시적 UI는 `useState`.

```ts
interface UiState {
  // 내비게이션
  activePage: 'home'|'review'|'kb'|'doc'|'sources'|'rules'|'history'|'add';
  selectedDocId: string | null;
  selectedCategory: string | null;
  treeOpen: Record<string, boolean>;
  go: (p: UiState['activePage']) => void;
  openDoc: (id: string) => void;          // page='doc' + select + 트리 해당 카테고리 자동 확장
  openCategory: (name: string) => void;   // page='kb' + selectedCategory(통합 보기)

  // KB 필터/뷰
  kb: { mode:'grid'|'cat'; personF:string; topicF:string; tagF:string|null; statusF:string; query:string; sort:'uses'|'recent'|'alpha'; };
  setKb: (patch: Partial<UiState['kb']>) => void;

  // 검토
  review: { tab:'all'|'ms'|'p0'|'p1'|'p2'; rvDone:Record<string,boolean>; detailPanelItemId:string|null; };
  setReviewTab: (t: UiState['review']['tab']) => void;

  // 단일 문서
  docTab: 'edit'|'source'|'relations'|'history'; docEditing: boolean;

  // 모달 / 토스트
  modal: { aiTags:boolean; catManager:boolean; };
  toast: { msg:string; type:'ok'|'warn'|'inf' } | null;
  showToast: (msg:string, type?:'ok'|'warn'|'inf') => void;

  role: UserRole;  // 기존 유지
}
```

> ⚠️ 검토 승인/멀티소스 해결로 생기는 **서버 변경**은 React Query mutation + invalidate가 정본이다. `rvDone`/`detailPanelItemId`는 낙관적 UI/오버레이 제어용 로컬 상태. LNB badge·홈 검토 대기 수는 `review` + data 훅 카운트를 함께 구독.

---

## 4. data provider 레이어 (React Query)

뷰는 **`src/data/hooks.ts`만** import한다. 내부는 Phase 1 엔드포인트를 기존 `apps/web/src/api/client.ts`의 `request<T>`로 호출.

```
apps/web/src/data/
  client.ts      // 신규 엔드포인트 fetch 래퍼(api/client.ts의 request<T>/ApiError 재사용)
  queryKeys.ts   // 기존 api/hooks.ts queryKeys 패턴 확장
  hooks.ts       // useKnowledgeItems / useKnowledgeItem / useTopics / useAiTagSuggestions
                 // useReviewBoard / useMultiSource / useDigest / useActivity / useTreeCategories
                 // + mutations: useResolveReview / useResolveMultiSource / usePatchKnowledge
                 //   useTopicMutations / useAiTagMutations
```

```ts
// 예: 조회 훅 — 기존 React Query 규약 그대로
export function useKnowledgeItems(q: KnowledgeQuery) {
  return useQuery({ queryKey: queryKeys.knowledge(q), queryFn: () => dataClient.listKnowledge(q) });
}
// 예: mutation — 성공 시 관련 쿼리 invalidate (useInvalidateAll 패턴 차용)
export function useResolveReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, role }) => dataClient.resolveReview(id, action, role),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.reviewBoard }); qc.invalidateQueries({ queryKey: queryKeys.digest }); },
  });
}
```

> ⚠️ 기존 `api/hooks.ts`(`useTree`/`usePublished`/`useDocument`/`useApprove`/`useReject`/`useJobStream`)는 **유지** — 실 n-depth 트리·SSE seam. 신규 `data/hooks.ts`가 (B)/(C) 풍부 데이터를 담당. 두 레이어 공존이 곧 문서화된 seam이다.

---

## 5. 공용 유틸 & 프리미티브

### 🛠️ 2.4 `lib/format.ts` — 목업 순수함수 이식

`dots(n)`/`dotColor(n)`(확실성), `avColor(name)`(아바타 색), `catTint(cat)`+`CAT_COLORS`(카테고리 색), `fmtBody(full)`(■/•/① → h4/ul/li 파서), `srcLevel(ch)`+`SRC_AUTH`(채널→L1..L4). 색/아이콘 맵은 여기(web)에 — shared 아님.

### 🛠️ 2.5 `components/common/`

`Toast`(스토어 구독), `Modal`(`modal-ov` 백드롭 닫기 셸), `Badge`/`PriBadge`(P0/P1/P2)/`Certainty`(`dots`)/`Avatar`(`avColor` + 이니셜).

> ⚠️ React는 JSX를 자동 escape하므로 목업의 `esc()`는 불필요 — 이식하지 않는다. `fmtBody`만 마크업 생성용으로 이식하되, 결과를 `dangerouslySetInnerHTML` 대신 React 엘리먼트로 빌드(가능하면) 또는 신뢰된 시드 본문에 한해 사용.

---

## 6. ✅ 완료 기준 (Definition of Done)

- [ ] `styles/tokens.css` 등 토큰 레이어 적용, 기존 `styles.css` 삭제, Inter 로드.
- [ ] `App.tsx`가 고정 LNB(256px) + `.main`(`margin-left`) + `activePage` 조건부 렌더 + 전역 `Toast`/`DetailPanel` 오버레이로 재작성.
- [ ] 임시 nav 클릭으로 `home/review/kb/doc` 빈 페이지 전환 + 시스템 메뉴 "준비 중" 스텁.
- [ ] `store.ts`에 내비/`kb`/`review`/`doc`/모달/토스트 슬라이스 + `go`/`openDoc`/`openCategory` 액션.
- [ ] `src/data/{client,queryKeys,hooks}.ts` 골격이 Phase 1 엔드포인트를 `request<T>`로 호출(타입은 `@wf/shared`).
- [ ] `lib/format.ts` + `components/common/*` 작성.
- [ ] 토큰(퍼플 `#5645d4` primary·네이비 `#0a1530`) 시각 확인, `pnpm --filter @wf/web typecheck` 통과(`noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`).

> ✅ 게이트 통과 시 화면 Phase(3~6)를 병렬로 착수 가능. 권장 순서: **3(LNB+트리) → 4(홈) → 5(조직지식+단일문서) → 6(검토)**.
> ⚠️ 기존 `IngestForm`/`HybridEditor`/`blocknote`/`monaco`/`buildTree`는 삭제하지 말 것(후속·seam). `App.tsx`에서 참조만 제거.
