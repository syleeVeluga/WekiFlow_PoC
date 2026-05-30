# Phase 6 — 검토 + 멀티소스 (최난도, 마지막)

> PRD 🚩 Phase 6: *목업 `pg-review` 재현 — 우선순위 검토 큐 + 상세 패널 + 멀티소스 충돌 해결(A/B/C/D).*
> *Human-in-the-loop review queue: priority groups, detail drawer, and four-type multi-source resolution.*

목표: 감지된 변화를 사람이 승인/반려하는 핵심 워크플로. 가장 복잡하므로 마지막에 배치하며, 이전 단계의 셸·data 훅·토스트·뱃지 동기 패턴을 모두 활용한다.

참조 목업: `pg-review`(986~1007줄), `RV_ALL`/`MS_GROUPS`/`SRC_AUTH`(1912~2083줄), `renderReview`/`riHTML`/`openRI`/`approveRI`/`approveBatch`(2085~2191줄), `msHTML`/`msApprove`/`msSplit` 등(2193~2255줄).

---

## 1. 컴포넌트 구성

```
apps/web/src/components/review/
  ReviewPage.tsx        // rv-head(탭+진행바) + rv-body
  ReviewTabs.tsx        // 전체/멀티소스/P0/P1/P2 (라이브 카운트)
  ReviewProgress.tsx    // rv-prog + 키보드 힌트
  ReviewItemCard.tsx    // riHTML
  ReviewDetailPanel.tsx // dp-ov 우측 드로어(openRI)
  MultiSourceGroup.tsx  // msHTML (타입 A/B/C/D)
```

데이터: `useReviewBoard()`(검토 항목+그룹핑) · `useMultiSource()` + mutations `useResolveReview` / `useResolveMultiSource`(+ split/request-confirm). 승인 게이트는 `canApprove(role)`(shared) 재사용.

---

## 2. 탭 · 진행바

### 🛠️ 6.1 `ReviewTabs` + `ReviewProgress`

- 탭(`setRVTab` → `review.tab`): 전체 / 멀티소스(+pulse dot) / 긴급 P0 / P1 확인 / P2 배치 — 각 라이브 카운트(`renderReview` 카운트 로직). 멀티소스 카운트 = 미해결 그룹수.
- 진행바: `done/total` (`rv-prog` 너비), 라벨 `N / M 검토 완료` + 예상 시간. 키보드 힌트 `Space 승인 · X 반려`.

---

## 3. 검토 항목 (단일 소스)

### 🛠️ 6.2 그룹 섹션 (`renderReview`)

- 탭이 `all`/`ms`면 **멀티소스 섹션 먼저**, 이어 P0/P1/P2 그룹. 각 그룹 헤더(라벨·카운트·도움말). **P2 그룹 헤더에 "전체 일괄 승인"**(`approveBatch('p2')`). 남은 항목 0이면 빈 상태("모든 검토를 완료했습니다").

### 🛠️ 6.3 카드 (`ReviewItemCard` / `riHTML`)

| 요소 | 목업 | 구현 |
| :--- | :--- | :--- |
| 상단 | 소스 채널·작성자·시간 + 우선순위 배지 | `source` + `PriBadge` |
| 변경 배지 | 충돌/신규/변경 | `changeType` |
| 본문 | 주제 + 부서 칩 + 요약(`nw`\|`ex.content`) + priReason | — |
| 우측 | 확실성 점(`dots`/`dotColor`) + ✓/✕ | `Certainty` + 버튼 |
| 애니메이션 | 승인/반려 시 `.gone` 슬라이드아웃(330ms) | CSS 트랜지션 + 제거 |

- ✓ `approveRI` / ✕ `rejectRI` → `useResolveReview` mutation → `rvDone` 낙관 갱신 + slide-out → invalidate. 성공 시 **카운트·LNB 뱃지·홈 검토 대기 동기 감소**.
- 카드(버튼 외 영역) 클릭 → `openRI(id)` 상세 패널.

### 🛠️ 6.4 상세 패널 (`ReviewDetailPanel` / `openRI`)

우측 드로어(`dp-ov`): 기존 내용(빨강 박스) / 감지된 새 내용(초록 박스) / **원천 대화**(thread) / 판단 근거 + 확실성. 푸터 반려·승인.

- **thread 분기**: `type==='slack'`이면 메시지 목록(아바타 `avColor` + 하이라이트 `hl`), `type==='email'`이면 from·subject·body 카드.

---

## 4. 멀티소스 (`MultiSourceGroup` / `msHTML`)

### 🛠️ 6.5 헤더 & 본문

- **헤더**(접이식 `msToggle`): 타입 배지(A 동일/B 유사/C 상충/D 선택적) + 설명 + **소스 권위 pill**(`srcLevel` → L1>L2>L3>L4) + 우선순위 + 확실성 + 펼침 토글.
- **본문**: 원천 소스 목록(baseline 강조) · 반영될 내용 박스 · 적용 대상 위키 문서 선택.

### 🛠️ 6.6 타입별 동작

| 타입 | 동작 |
| :--- | :--- |
| A 동일 | 복수 소스 확증 → L1 기준 소스 내용 반영. 타깃 선택 후 승인. |
| B 유사 | **버전 비교**(`msPickVer` A/B) → 선택해야 승인 가능. 채택 내용 박스. |
| C 상충 | 충돌 노트("AI 자동 해결 불가"). 타깃 선택 **비활성**, 승인 차단 → `msSplit`(분리) / `msConfirmReq`(담당자 확인 요청)만. |
| D 선택적 | 적용 대상 문서 선택적 반영. |

- 타깃 선택(`msToggleTarget`, C 제외), 승인(`msApprove`): **≥1 타깃 + (B는 버전 선택)** 필요. `useResolveMultiSource` → `/api/multi-source/:id/resolve`. 분리/확인요청은 각 엔드포인트.
- 각 액션 완료 → 그룹 제거 + 토스트 + 카운트/홈/LNB 갱신.

> ⚠️ 타입 C의 `resolve`는 서버가 409로 거부(Phase 1) — 프론트에서도 승인 버튼 비활성으로 이중 방어. 목업 규칙("담당자 직접 확인") 보존.

---

## 5. 키보드 단축키

### 🛠️ 6.7 전역 리스너

```tsx
// activePage==='review' && 상세 패널 닫힘일 때만
// Space → 첫 미완료 항목 승인, X → 반려
useEffect(() => { /* keydown 등록/해제, review 페이지 게이트 */ }, [activePage, detailPanelItemId]);
```

> ⚠️ 입력 포커스(textarea/검색) 중에는 단축키 무시. 승인/반려는 `canApprove(role)` 통과 시에만(비권한은 무시 + 토스트).

---

## 6. ✅ 완료 기준 (Definition of Done)

- [x] 탭(전체/멀티소스/P0/P1/P2)이 라이브 카운트로 필터, 진행바가 승인/반려에 따라 전진.
- [x] 카드 ✓/✕가 slide-out 후 제거되고 **카운트·LNB 뱃지·홈 검토 대기**가 동기 감소.
- [x] 상세 패널이 slack 스레드(아바타·하이라이트)와 email(from·subj·body)을 각각 정확히 렌더.
- [x] 멀티소스 A/B/C/D 각 동작: B는 버전 선택 강제, C는 승인 차단 + 분리/확인요청, 타깃 ≥1 강제.
- [x] P2 "전체 일괄 승인"이 P2 전체를 정리. 모두 처리 시 빈 상태 표시.
- [x] 키보드 Space/X가 검토 페이지·패널 닫힘에서만 동작, 비권한 차단.
- [x] 모든 변경이 `data/hooks` mutation으로 서버 반영 + invalidate(`canApprove` 게이트).
- [x] `pnpm --filter @wf/web typecheck` 통과.

> ✅ 게이트 통과 시 5+1 화면 전체가 목업 파리티로 동작. 교차 일관성(LNB ↔ 홈 ↔ 검토 카운트)을 최종 점검한다.
> ⚠️ 실 파이프라인이 `review_items`/`multi_source_groups`를 생성하는 연동은 후속(현재는 시드 데이터 기반). `documentId` join 키로 실 문서 반영을 연결할 seam은 이미 마련됨.
