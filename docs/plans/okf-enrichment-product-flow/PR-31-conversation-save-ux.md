# PR-31 — Conversation Save UX (T3 프런트엔드)

> Track T3 · 상태: 계획 · 선행: [PR-30](./PR-30-conversation-ingest-backend.md) · 근거: [`Overview.md`](./Overview.md) §5.2-2, [`Gap-Analysis.md`](./Gap-Analysis.md) §3.2
> 외부 API 메모: 채널 가져오기는 PR-29 mock connector를 통해 표시(라이브 미연결).

## 목표

채팅/회의록 화면에서 "지식으로 저장 / 후보로 올리기 / 출처 필요" 흐름을 제공한다. 사용자가 대화 중 선택한 내용을 PR-30 API로 보내 후보를 만든다.

## 범위

- **In:**
  - 대화/회의록 입력 화면(붙여넣기 또는 PR-29 connector에서 가져오기).
  - 텍스트 선택 → "지식으로 저장" 액션, 결과를 후보로 표시.
  - 대화 후보에 "출처 필요" 배지(PR-26 `needsSource`).
- **Out:** 백엔드 추출(PR-30), 라이브 Slack 연동, 위험도 승인 화면(PR-32).

## 변경 파일

- 🆕 `apps/web/src/components/conversation/ConversationPage.tsx` — 입력·선택·저장 UI.
- 🆕 `apps/web/src/components/conversation/SaveAsKnowledgeMenu.tsx` — 선택 텍스트 컨텍스트 액션.
- 🔧 `apps/web/src/store.ts` — `activePage`에 `conversation` 추가.
- 🔧 `apps/web/src/api/hooks.ts` — `useConversationIngest()`.
- 🔧 LNB 내비게이션 — "대화에서 저장" 진입점 추가.

## 구현 단계

1. **입력 화면.** transcript 붙여넣기 또는 PR-29 mock connector에서 채널/스레드 선택해 불러오기.
2. **선택 저장.** 발화 블록 선택 → "지식으로 저장 / 후보로 올리기" → PR-30 `POST /api/conversation-ingest` 호출. 결과 후보 ID로 후보 카드 미리보기.
3. **신뢰 표시.** 생성된 대화 후보에 PR-27 `TrustLabel`(`확인 필요`) + "출처 필요" 배지 표시. 원본 문서 연결 액션 제공.
4. **연결 흐름.** "출처 필요" 후보에서 기존 문서를 검색해 `linkedDocId` 연결 → 상태 승급 가능하게.
5. **빈 상태.** connector 미연결 시 mock 채널만 보이며 "라이브 연동 예정" 안내.

## 테스트

- 선택 → 저장 → 후보 생성 happy path(mock).
- 대화 후보에 `확인 필요` + `출처 필요` 표시.
- 원본 연결 후 상태 승급 가능.
- connector 미연결 빈 상태 렌더.

## DoD

- [ ] 대화/회의록에서 텍스트를 선택해 후보로 저장할 수 있다.
- [ ] 대화 후보가 `확인 필요`·`출처 필요`로 명확히 표시된다.
- [ ] 출처 연결 흐름이 동작한다.
- [ ] mock connector로 채널 가져오기 UI가 동작한다.

## 리스크·메모

- 라이브 Slack 미연결이므로 "가져오기"는 mock 데이터 — UI는 실제 연동 시 그대로 재사용 가능하도록 connector 추상화에 의존.
- 대화 저장은 항상 후보일 뿐 공식 지식이 아님을 UI 문구로 명확히(Overview §2.3).
