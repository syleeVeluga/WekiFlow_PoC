# Phase 4 — 홈 대시보드

> PRD 🚩 Phase 4: *목업 `renderHome` 재현 — 히어로·상태바·데일리 다이제스트·4위젯.*
> *The home: hero greeting, live status bar, daily digest narrative, four widgets.*

목표: 조직 운영 기억의 "오늘"을 보여주는 홈 화면. 대부분 읽기 전용이지만 다이제스트의 entity·인용·위젯 헤더가 문서/검토로 딥링크된다.

참조 목업: `pg-home`(944~984줄), `renderHome`(1567~1638줄).

---

## 1. 컴포넌트 구성

```
apps/web/src/components/home/
  HomePage.tsx           // home-wrap 컨테이너 + 히어로
  StatusBar.tsx          // #home-statusbar
  DailyDigest.tsx        // #home-digest
  AutoProcessingGauge.tsx// #home-apr
  MostAskedTopics.tsx    // #home-mat
  PersonCoverage.tsx     // #home-pcov
  RecentActivity.tsx     // #home-activity
```

데이터: `useDigest()`(상태바 지표·다이제스트·자동처리율·가장많이묻는주제·커버리지) + `useActivity()` + `review` 카운트 구독.

---

## 2. 화면 요소 (목업 대응)

| 요소 | 목업 | 구현 노트 |
| :--- | :--- | :--- |
| 히어로 | `home-hero` | eyebrow "조직의 운영 기억" + `안녕하세요, 이지수님` + 부제(이름·날짜·상태) |
| 상태바 | `home-statusbar` | 7지표: 정상 운영 / Slack 12채널 / 오늘 분석 347 / 추출 23 / **검토 대기**(클릭→`go('review')`, 라이브) / 자동 처리 20 / 미답변 5 |
| 데일리 다이제스트 | `home-digest` | 아래 §3 |
| 자동처리율 게이지 | `home-apr` | 43% 마커 + 권장 40~60% 존 + 경고 노트 |
| 가장 많이 묻는 주제 | `home-mat` | 막대(법인카드 43 …), 건강검진은 `⚠ 충돌` flag, 헤더 "답변하기"→`go('review')` |
| 담당자별 커버리지 | `home-pcov` | 담당자 막대 + 태그(양호/보강 필요/미배정 多), 헤더 "전체 보기"→`go('kb')` |
| 최근 활동 | `home-activity` | `useActivity()` 상위 5, 행 클릭→`go('history')`(스텁) |

### 🛠️ 4.1 상태바 — 라이브 검토 대기 수

```tsx
// 검토 대기 = useReviewBoard 미완료 + useMultiSource 그룹수 (LNB 뱃지와 동일 셀렉터)
<div className="hsb-item clickable" onClick={() => go('review')}>
  <span className="hsb-label">검토 대기</span>
  <span className="hsb-num" style={{ color: 'var(--orange)' }}>{pendingCount}</span>
</div>
```

---

## 3. 데일리 다이제스트 (`DailyDigest.tsx`) — 핵심

목업은 "오늘, 조직이 새로 배운 것" 내러티브에 클릭 가능한 entity/인용/citation을 inline으로 박아 넣는다(`dg-entity onclick="openDoc('k35')"`, `dg-cite onclick="setRVTab('p0');go('review')"`).

### 🛠️ 4.2 구조화된 토큰으로 렌더 (HTML 주입 금지)

```tsx
// DigestSection.entities[] = { kind:'conflict'|'new'|'update', itemId, title, quote? }
// 본문을 [텍스트 | EntityChip | Citation] 토큰 배열로 모델링하고 실제 React 핸들러로 렌더
<span className="dg-entity dge-conflict" onClick={() => openDoc(ref.itemId)}>{ref.title}</span>
<span className="dg-cite" onClick={() => { setReviewTab('p0'); go('review'); }}>[1]</span>
```

3개 섹션: **충돌이 감지된 정책**(⚠ 직접 판단 필요) / **새로 감지된 조직 지식**(+신규 N건) / **기존 지식이 갱신됩니다**(↑ 업데이트 N건). 상단에 "오늘 가장 자주 검색된 주제" 박스.

> ⚠️ 목업의 `innerHTML` 내러티브를 그대로 `dangerouslySetInnerHTML`로 넣지 말 것 — XSS·클릭 핸들러 유실. `DailyDigest`를 타입드 토큰 리스트(`@wf/shared`의 `DigestSection`/`DigestEntityRef`)로 받아 React 엘리먼트로 조립한다.

---

## 4. 위젯 (게이지·막대)

- **자동처리율**(`apr`): 그라데이션 바 위 `left:43%` 마커, 40~60% 권장 존 음영, "60% 초과 시 검토 형식화 / 40% 미만 시 가치 저하" 노트. 정적 지표(시드 상수, digest 응답 포함).
- **가장 많이 묻는 주제**(`mat`): `Math.max` 정규화 막대 + 건수 + `flag` 배지.
- **담당자별 커버리지**(`pcov`): 아바타(`avColor`) + 이름/역할 + 정규화 막대 + 색 태그.

> ⚠️ `mat`/`pcov`의 색은 목업 inline 색을 유지하되, 데이터는 `useDigest()` 응답(부서·작성자 집계 + 시드 상수)에서 받는다.

---

## 5. ✅ 완료 기준 (Definition of Done)

- [ ] 히어로·상태바·다이제스트·4위젯이 목업과 시각적으로 일치.
- [ ] 상태바 "검토 대기" 수가 LNB 검토 뱃지와 동일하고, 검토 승인/반려(Phase 6) 후 함께 감소.
- [ ] 다이제스트 entity 클릭 → 올바른 문서(`openDoc`)·검토 탭(`setReviewTab`+`go`)로 이동. HTML 주입 없이 React 핸들러로 동작.
- [ ] 위젯 헤더 "답변하기"→검토, "전체 보기"→조직 지식 이동.
- [ ] 자동처리율 게이지 마커/존, 가장많이묻는주제 flag, 커버리지 태그 렌더.
- [ ] 최근 활동 상위 5건(`useActivity`) 렌더, 행 클릭은 스텁(history).
- [ ] `pnpm --filter @wf/web typecheck` 통과.

> ✅ 게이트 통과 시 **Phase 5(조직 지식 + 단일 문서)**로 진행.
> ⚠️ 검색 빈도·"오늘 분석 N개" 등 챗봇 텔레메트리는 시드 상수(원천 로그 없음) — 향후 실 로그로 교체할 seam.
