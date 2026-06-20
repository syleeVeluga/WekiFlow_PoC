# PR-34 — Discovery Trust: 답변 출처·신뢰 표시 + Ask 화면 (T6)

> Track T6 · 상태: 완료(PR #46, 2026-06-21) · 선행: [PR-26](./PR-26-candidate-contract.md), [PR-27](./PR-27-candidate-model-and-trust-labels.md), [PR-33](./PR-33-knowledge-map.md)(backlinks 단서) · 근거: [`Overview.md`](./Overview.md) §3.4·§5.2-5, [`Gap-Analysis.md`](./Gap-Analysis.md) §3.7
> 외부 API 메모: 없음.

## 목표

Discovery 답변에 **출처와 신뢰 상태**를 실어 보내고, 이를 보여주는 **Ask/Q&A 화면**을 만든다. 공식 지식·출처확인 지식을 우선 검색하고, `확인 필요` 후보를 사용하면 답변에 표시한다. 답변 실패는 Learner/Conversation 흐름으로 되돌린다.

## 범위

- **In:**
  - `/api/ask` 응답에 citations + 각 출처의 신뢰 상태(PR-26 라벨) 포함.
  - 검색 우선순위: 공식 지식 > 출처확인 > 확인필요(사용 시 표시).
  - 웹 Ask 화면(질문·답변·출처 카드·신뢰 라벨·관련 지식 backlinks).
  - 답변 실패 시 누락 신호를 learner/conversation으로 전달.
- **Out:** 검색 엔진 자체(hybrid 기구현), 지식 맵(PR-33), 후보 생성(PR-28/30).

## 변경 파일

- 🔧 `packages/shared/src/index.ts` — Ask 응답·citation·follow-up DTO 추가.
- 🔧 `apps/api/src/server.ts` — `/api/ask` 응답 스키마를 `{ answer }` → `{ answer, citations[], usedTrustLevels[] }`로 확장(SSE 이벤트 유지), citation/trust 메타 부착.
- 🔧 `apps/web/src/api/client.ts` — POST SSE 소비 경로 추가.
- 🆕 `apps/web/src/components/ask/AskPage.tsx` — 질문 입력·스트리밍 답변·출처 카드·신뢰 라벨.
- 🔧 `apps/web/src/store.ts` — `activePage`에 `ask` 추가.
- 🔧 `apps/web/src/api/hooks.ts` — `useAsk()`(SSE 소비, citations 파싱).

## 구현 단계

1. **검색 우선순위.** discovery가 후보/문서의 PR-26 상태를 읽어 공식 지식·출처확인을 우선 반영. `확인 필요` 후보 사용 시 답변 메타에 플래그.
2. **citation 부착.** 답변에 사용된 각 청크/문서를 citation(title·path·trustStatus)으로 수집. SSE `answer` 이벤트에 함께 전송.
3. **응답 스키마.** 기존 `{ answer }` 호환 유지하되 `citations`·`usedTrustLevels` 추가. 503/오류 흐름 유지.
4. **Ask 화면.** 질문 입력 → 스트리밍 답변 → 하단 출처 카드(각각 PR-27 `TrustLabel`). `확인 필요` 출처가 섞이면 답변 상단에 주의 배지.
5. **관련 지식.** PR-33 backlinks로 "관련 지식" 제안. 답변 실패(근거 부족) 시 "부족한 지식" 신호를 learner/conversation 큐로 전달.

## 테스트

- 응답: citations·usedTrustLevels 포함, 구버전 `{answer}` 소비자 비파손.
- 우선순위: 공식 지식 우선, `확인 필요` 사용 시 플래그.
- UI: 스트리밍 답변, 출처 카드 라벨, 주의 배지 표시.
- 실패 경로: 근거 부족 → 누락 신호 전달.

## 검증

- PR #46: <https://github.com/syleeVeluga/WekiFlow_PoC/pull/46>
- `corepack pnpm --filter @wf/shared test -- index`
- `corepack pnpm --filter @wf/api typecheck`
- `corepack pnpm --filter @wf/api test -- server`
- `corepack pnpm --filter @wf/web typecheck`
- `corepack pnpm -r typecheck`
- `corepack pnpm -r test`
- `corepack pnpm build`
- `git diff --check`
- GitHub CI `verify` on PR #46
- Browser smoke was attempted, but the in-app browser runtime failed before navigation and bundled Playwright was missing `playwright-core`; no browser dependency was added.

## DoD

- [x] `/api/ask`가 출처와 신뢰 상태를 함께 반환한다.
- [x] Ask 화면에서 답변·출처·신뢰 라벨이 보인다.
- [x] `확인 필요` 출처 사용 시 답변에 표시된다.
- [x] 답변 실패가 learner/conversation 흐름으로 환류된다.

## 리스크·메모

- `/api/ask`는 현재 SSE(`writeSse(... 'answer', { answer })`)이므로 **이벤트 페이로드 확장**으로 처리(엔드포인트 형태 유지).
- 신뢰 라벨은 PR-27 컴포넌트 재사용으로 UI 일관성 확보.
