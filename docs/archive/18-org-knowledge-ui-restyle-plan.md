# 18 — 조직 지식(KB) 메뉴 UI 적용 계획

> 첨부 스크린샷 2장(① `법인카드` **통합 보기**, ② `근태·휴가` **그리드 + AI 배너**)을 기준으로
> `조직 지식`(KB) 메뉴 화면을 디자인 목업(`docs/Design Reference/v-wiki.html`)에 맞춰 **시각적으로 재정렬**한다.
> 데이터·동작은 이미 Phase 5(`docs/15-frontend-ui/06-phase-5-org-knowledge.md`)에서 완성되어 있으므로, 이 작업은 **마크업·CSS 리스타일**에 한정한다.

---

## 1. 참조

- 스크린샷 ① — `pg-kb`의 **통합 보기**(`openCategoryView`): 좌측 필터 레일 + 상단 검색/카운트/뷰토글/정렬/직접추가 + `문서 #N` 스크롤.
- 스크린샷 ② — `pg-kb`의 **그리드**(`renderKB` grid): 주황 `AI 자동 분류 제안 검토 대기` 배너 + 카드 그리드.
- 목업 마크업: `pg-kb` 11`09`~1053, `renderKBSidebar`/`kbFilteredItems`/`renderKB`/`kbCardHTML`/`renderCatView`/`openCategoryView` 1660~1824.
- 목업 CSS: `.wiki-shell`~`.intg-doc-body` 352~436, 토큰 `:root` 10~37.
- 현행 구현: [KbPage.tsx](../apps/web/src/components/kb/KbPage.tsx), [kb.css](../apps/web/src/styles/kb.css), [tokens.css](../apps/web/src/styles/tokens.css), [format.tsx](../apps/web/src/lib/format.tsx).

---

## 2. 현재 상태 분석 (Gap)

| 영역 | 현행 | 목업(스크린샷) | 결론 |
| :--- | :--- | :--- | :--- |
| 페이지 레이아웃 | `.main`(padding:28px) 안에서 `.pg`(max-width:1280, 가운데정렬) | LNB에 **밀착**된 전체높이 2-pane(`wiki-shell{display:flex;height:100vh}`), 좌 필터 레일 + 우 메인(자체 스크롤) | **전체블리드 2-pane로 변경** |
| 필터 사이드바 | `.kb-filter card` + `h3` + `.filter-row` 버튼 | `.wiki-filter`(230px, 우측 border) + 대문자 `.wf-label` + `.wf-row`(아바타/색점) + `.wf-tag-row` + 구분선 | **마크업·클래스 교체** |
| 상단바 | `<h1>조직 지식</h1>` + `AI 태그 검토` 버튼 + 기본 input/select | `.wiki-topbar`(56px): `⌕` 검색 + `N개 중 M개` 카운트 + 세그먼트 토글(그리드\|카테고리별) + 정렬 select + `+ 직접 추가` | **h1·AI버튼 제거**, 세그먼트 토글 도입 |
| AI 검토 | topbar 버튼 | 주황 `.ai-banner`(🤖 + 텍스트 + 카운트 pill + →) | **배너로 이동** (클릭 시 모달) |
| 카드 | 기본 `.card` + `Badge` + 28px 아바타 | `.kbc`(상태점 우상단 + `#`태그 peach pill + 카테고리 칩 tint + `수정 N` 배지 + 18px 아바타 + `참조 N`) | **카드 재구성** |
| 카테고리별 | 그룹 헤더 + 그리드 (OK) | 동일 구조, 헤더에 색점/건수 pill/`통합 보기 →`, `미분류` 경고 | **헤더 스타일 정합** |
| 통합 보기 | **별도 페이지**(`.pg category-view`) → 필터 레일이 사라짐 | `wiki-content` **안에서** 렌더 → 필터 레일·상단바 유지 | **셸 내부 렌더로 이동** |
| 디자인 토큰 | `--surface/--ink/--muted/--orange/--green/--sh-md` 등이 목업과 **값이 다름**, `--canvas/--hairline*/--stone/--steel/--slate/--charcoal/--teal/--tint-*/--orange-deep/--link/--purple-soft/--r-sm·md·lg·full` **부재** | 목업 팔레트 | **부재 토큰 추가 + 충돌 토큰은 `.wiki-shell`에 스코프** |

데이터(`KnowledgeItem`)는 이미 충분: `title/summary/contentMarkdown/category/freshness/usageCount/modCount/sourceLabel/authorName/updatedAtLabel/aiTags/origin/lastChange`. **데이터·API·hooks·store 변경 없음.**

---

## 3. 적용 결정 (가정)

1. **전체블리드 레이아웃**: KB 루트는 `.pg`를 떼고 `.wiki-shell{margin:-28px;height:100vh;display:flex}`로 `.main`의 28px 패딩을 상쇄해 LNB에 밀착시킨다. 다른 페이지는 그대로 둔다.
2. **토큰 스코핑**: 전역 `tokens.css`는 **건드리지 않는다**(홈·검토·LNB 회귀 방지). 목업 팔레트(부재 토큰 + 값이 다른 토큰)는 `.wiki-shell { --canvas:…; --surface:…; … }`로 **KB 페이지에만** 적용한다. CSS 변수 상속으로 셸 내부(모달 포함)에만 영향.
3. **통합 보기는 셸 내부 렌더**: 조기 `return` 대신 `wiki-content` 안에서 그리드/그룹/통합을 분기. 진입(`openCategory`)·복귀(`← 위키 홈으로` → `setKb({mode:'grid',topicF:'all'})`) 동작은 보존.
4. **카테고리 칩 tint**: 시드 카테고리(`법인카드/출장/복리후생/사무환경/보안/입퇴사/건강검진/미분류`)는 목업 카테고리명과 다르므로, 칩은 `catTint(cat)`(채도색)을 글자색으로, 배경은 그 색의 저투명도(`color+"1a"`)로 **유도**한다. 카테고리별로 별도 tint 변수 매핑은 두지 않는다(`format.tsx` 무수정).
5. **작은 아바타**: 공용 `Avatar`(28px)는 다른 페이지와 공유하므로 건드리지 않고, 필터행/카드에는 `.wf-av`(20px)/`.kbc-av`(18px)를 `avColor(name)` 인라인 배경으로 직접 렌더.
6. **공유 클래스 보존**: `.filter-row`는 홈(`HomePage`)·KB 모달이 사용하므로 `kb.css`에서 **삭제하지 않는다**. `.cat-dot`은 `tree.css` 소관이라 영향 없음.
7. **`+ 직접 추가`**: `add` 페이지는 스텁이므로 `showToast('준비 중입니다')` 유지(네비게이션 이탈 방지).
8. **상태 필터 라벨**: 목업처럼 `전체 / ✓ 최신 / ⚠ 업데이트 필요 / ● 충돌 감지` + 색상으로 표기.

### 비범위 (Out of scope)

- **단일 문서**(`DocPage`)·소스/규칙/이력/직접추가 페이지 — 스크린샷에 없음.
- LNB 트리·전역 토큰·공용 `Avatar` 변경.

> ⚠️ 처음엔 시드 재구성을 비범위로 뒀으나, 사용자 요청("우선 맞춥니다")에 따라 **시드를 목업 데이터로 정렬**했다 — §7 참조.

---

## 4. 구현 항목

### 4.1 [kb.css](../apps/web/src/styles/kb.css) — 재작성
- 상단에 `.wiki-shell { /* 목업 토큰 스코프 */ }` 블록: `--canvas/--surface/--surface-soft/--hairline/--hairline-soft/--hairline-strong/--stone/--steel/--slate/--charcoal/--ink/--muted/--teal/--orange/--orange-deep/--link/--purple-soft/--tint-peach/sky/mint/lavender/rose/yellow/gray/--info-soft/--success-soft/--error/--r-sm·md·lg·full`.
- `.wiki-shell{margin:-28px;height:100vh;display:flex;overflow:hidden}` + 목업 352~436의 KB/통합 보기 클래스 이식(`.wiki-filter .wf-* .wiki-main .wiki-topbar .wiki-search .wiki-count .view-seg .wiki-sort .wiki-content .ai-banner .wiki-grid .kbc .intg-*`).
- **`.filter-row` 규칙은 그대로 유지**(공유).

### 4.2 [KbPage.tsx](../apps/web/src/components/kb/KbPage.tsx) — 마크업 교체
- 루트 `<section className="wiki-shell">` (`.pg` 제거).
- `KbFilterSidebar` 영역: `.wiki-filter` → `.wf-sec`×4(담당자/주제 분류/AI 자동 분류 태그/상태) + `.wf-divider`. 행은 `.wf-row`/`.wf-tag-row` + `.wf-av`/`.wf-dot`/`.wf-cnt`.
- `.wiki-main` → `.wiki-topbar`(검색·카운트·`.view-seg`·정렬·`+직접추가`) + `.wiki-content`.
- `.wiki-content` 분기: `integrated ? <IntegratedView/> : (배너 + (grid ? 그리드 : 그룹))`.
- 카드 `KnowledgeCard` → `.kbc` 구조(상태점/desc/`#`태그/`.kbc-foot`: 칩·수정·아바타·참조).
- `IntegratedView`(기존 `CategoryView` 대체): `.wiki-intg`(`.intg-head`/`.intg-divider`/`.intg-doc`×N). 본문은 `■/•/①` 라인을 목업 `fmtBody`처럼 `<h4>/<ul><li>/<p>`로 렌더.
- 모달 2종(`AiTagReviewModal`/`CategoryManagerModal`)은 기능 유지(스타일 최소 변경).

### 4.3 format.tsx — **무수정** (결정 4·5에 따라 기존 export 재사용).

---

## 5. 완료 기준 (DoD)

- [ ] KB 페이지가 LNB에 밀착된 전체높이 2-pane으로 렌더(좌 230px 필터 레일 + 우 메인, 각자 스크롤).
- [ ] 상단바: `⌕` 검색 + `N개 중 M개` + 세그먼트 토글(그리드/카테고리별, on 강조) + 정렬(참조 많은순/최근 수정순/가나다순) + `+ 직접 추가`.
- [ ] 그리드 카드가 목업과 일치: 상태점·`#`태그 peach pill(+N)·카테고리 칩(tint)·`수정 N` 배지·작성자 아바타·`참조 N`.
- [ ] AI 제안>0일 때 주황 `ai-banner` 노출 → 클릭 시 AI 태그 모달.
- [ ] 카테고리별 그룹 헤더(색점/건수 pill/`통합 보기 →`) + `미분류` 경고.
- [ ] 통합 보기가 **필터 레일·상단바를 유지한 채** `문서 #N` 블록을 스크롤 렌더, `← 위키 홈으로` 복귀.
- [ ] 4필터·검색·정렬·뷰토글 동작 보존(데이터/동작 무회귀).
- [ ] 다른 페이지(홈/검토/LNB) 시각 회귀 없음(전역 토큰 무변경).
- [ ] `pnpm -r build` 후 `pnpm --filter @wf/web typecheck` 통과.

---

## 6. 검증

1. `pnpm -r build` → `pnpm --filter @wf/web typecheck` (워크스페이스 타입은 dist 경유 — build 선행).
2. 가능 시 `pnpm --filter @wf/web dev`로 스크린샷 ①②와 육안 대조.

---

## 7. 추가: 시드 데이터 목업 정렬 (승인됨)

스크린샷의 실제 문서 제목·카테고리를 재현하기 위해 시드를 목업(`v-wiki.html`)의 `KB_ALL`로 교체.

- **추출 스크립트** [scripts/extract-wiki-seed.mjs](../scripts/extract-wiki-seed.mjs): 목업 HTML에서 `raw[]`(88건) + `AI_TAGS_MAP`을 슬라이스·평가해 `KnowledgeItem` 형태로 변환, **재실행 가능**.
- **생성물** `packages/shared/src/wiki/seedKnowledge.ts`: `SEED_KNOWLEDGE_ITEMS`(88건, 손수정 금지). 카테고리 분포 = 법인카드 10·출장·정산 8·사무환경 10·복리후생 10·근태·휴가 10·급여·상여 7·채용·온보딩 8·장비·소프트웨어 8·사내시스템 10·보안·권한 7 = **88** (스크린샷 일치).
- [seed.ts](../packages/shared/src/wiki/seed.ts): `topicNames`→목업 11분류(미분류 포함, 전부 `system`), `createSeedKnowledgeItems`→생성물 깊은 복제, `createSeedAiTagSuggestions`→3건(배너 카운트 3 일치).
- [format.tsx](../apps/web/src/lib/format.tsx): `CAT_COLORS`→목업 카테고리·색상.

**필드 매핑**: `tp→title, pv→summary, full→contentMarkdown, dp→department, cat→category, status→freshness, uses→usageCount, upd→modCount, src→sourceLabel, by→authorName, dt→updatedAtLabel, AI_TAGS_MAP→aiTags, ori→origin, chg→lastChange`.

**미정렬(의도적 보류)**: 검토(`createSeedReviews`)·멀티소스(`createSeedMultiSourceGroups`)·다이제스트의 `documentId/itemId`는 여전히 `k01~k88`을 가리켜 링크는 유효하나, 일부 표시용 제목·카테고리가 새 문서와 다를 수 있음(검토/홈 페이지는 본 작업 범위 밖). 필요 시 후속 정합.

**검증**: `pnpm -r build` ✅ · `@wf/web typecheck` ✅ · 테스트 shared 12 / api 8 / web 3 ✅(문서 88건·멀티소스·주제 삭제 게이트 유지).
