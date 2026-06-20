# PR-30 — Conversation Ingest API·Worker + provenance (T3 백엔드)

> Track T3 · 상태: 완료(PR #42) · 선행: [PR-26](./PR-26-candidate-contract.md), [PR-27](./PR-27-candidate-model-and-trust-labels.md), [PR-29](./PR-29-source-connector-interface.md) · 근거: [`Overview.md`](./Overview.md) §3.2·§5.1-3, [`Gap-Analysis.md`](./Gap-Analysis.md) §2.3·§2.7
> 외부 API 메모: Slack/회의록 입력은 PR-29 mock connector를 통해 수신(라이브 미연결).

## 목표

대화/회의록/채팅에서 지식 후보를 생성하는 **Conversation Ingest Agent**의 API와 워커를 구현한다. 기존 learner를 "실패 궤적 분석"에만 묶지 않고 대화형 후보 생성에 재사용한다. 대화 기반 후보는 공식 지식과 다르게 취급한다(`needsSource`, `NEEDS_CHECK`).

## 범위

- **In:**
  - `POST /api/conversation-ingest`(대화/transcript 입력 → 후보 추출 job 생성).
  - `workers/conversation`(또는 learner 확장) — 결정사항·정책성 발언·반복 질문·TODO 추출 → `KnowledgeCandidate`.
  - 대화 provenance(`conversationQuote`, `speaker`, `createdFromConversation`, `needsSource`) 기록.
  - PR-29 Slack/Meeting connector로부터의 입력 경로.
- **Out:** 프런트 "대화에서 저장" UX(→ PR-31), 위험도 승인 라우팅(→ PR-32), 라이브 Slack 연동.

## 변경 파일

- 🆕 `apps/api/src/routes/conversationIngest.ts` (또는 `server.ts` 라우트 추가) — 입력 검증·job enqueue.
- 🆕 `workers/conversation/src/pipeline.ts` — `runConversationIngest(input)`.
- 🆕 `packages/agent-tools/src/conversation.ts` — `extractConversationCandidates(transcript)` 프롬프트+파서(결정/정책/FAQ/TODO 분류).
- 🔧 `packages/shared/src/index.ts` — `jobQueues`에 `conversation` 추가, `jobTypes`에 `INGEST_CONVERSATION` 추가.
- 🔧 `packages/db/src/candidateRepository.ts` — 대화 provenance 저장 연동.

## 구현 단계

1. **API.** `{ source: 'manual'|'slack'|'meeting', transcript|ref, workspaceId }` 검증 후 `conversation` 큐에 job enqueue. ref면 PR-29 connector로 fetch.
2. **추출 에이전트.** transcript에서 (a) 결정사항 (b) 정책성 발언 (c) 반복 질문 (d) TODO를 분류 추출. 각 항목을 후보 초안으로 변환하고 발화 인용·화자를 보존.
3. **provenance.** 모든 대화 후보는 `provenance.kind='conversation'`, `conversationQuote`/`speaker`/`createdFromConversation=jobId` 채움. 출처가 대화뿐이면 `needsSource=true`, 기본 상태 `NEEDS_CHECK`(PR-26 규칙).
4. **공식화 게이트.** 대화 후보는 auto-publish 불가. 공식화에는 담당자 승인 또는 원본 문서 연결(`linkedDocId`)을 요구.
5. **learner 재사용.** 기존 `judgeTrajectory` 로직 중 추출 가능한 부분은 공유 유틸로 분리해 중복 제거.

## 테스트

- 추출: 샘플 transcript → 결정/정책/FAQ/TODO 분류 정확성.
- provenance: 대화 후보가 `needsSource=true`·`NEEDS_CHECK`로 생성됨.
- auto-publish 차단: 대화 후보는 `canAutoPublish=false`.
- connector 경로: PR-29 mock Slack/Meeting 입력으로 end-to-end job 완료.

## DoD

- [x] 대화/회의록 입력으로부터 후보를 생성하는 API·워커가 존재한다.
- [x] 대화 후보가 발화 인용·화자·`needsSource` provenance를 갖는다.
- [x] 대화 후보는 승인/원본연결 없이 공식 지식이 되지 않는다.
- [x] PR-29 mock connector로 전체 경로가 검증된다.

## 리스크·메모

- 대화 내용의 공식 지식 직접 저장 금지 원칙(Overview §2.3) 준수 — 후보·결정사항·FAQ·누락 신호만 생성.
- 워커 신설 vs learner 확장은 트레이드오프 — 결정·FAQ 추출은 신설 워커, gap 신호는 기존 learner 유지 권장.
