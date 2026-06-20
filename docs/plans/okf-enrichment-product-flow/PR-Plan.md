# OKF Enrichment Product Flow — 상세 PR 계획 (인덱스)

> 작성일: 2026-06-20
> 근거: [`Overview.md`](./Overview.md), [`Gap-Analysis.md`](./Gap-Analysis.md)
> 번호 체계: 기존 OKF PR-01~20, dev-control-panel PR-21~25 완료에 이어 **PR-26부터** 시작.

[`Gap-Analysis.md`](./Gap-Analysis.md)에서 확정한 갭을 기능 단위 PR로 분할한 상세 구현 계획이다. 각 PR은 별도 문서이며 목표/범위/변경 파일/구현 단계/테스트/DoD/리스크를 담는다.

## 외부 API 정책

Slack·Google Drive·회의록 등 외부 API 연결은 **구조와 기능 인터페이스만** 구현한다([PR-29](./PR-29-source-connector-interface.md)). 실제 인증·네트워크 호출은 mock/stub로 두고 라이브 테스트는 범위 밖이며, 후속 연동 PR에서 채운다. 인입·대화 인입 PR은 이 mock connector를 통해 end-to-end로 검증한다.

## PR 목록

| PR | 제목 | 트랙 | 선행 | 핵심 산출 |
| :--- | :--- | :--- | :--- | :--- |
| [PR-26](./PR-26-candidate-contract.md) | Candidate Contract & 상태기계 | T1(선행) | — | 후보 상태·위험도·provenance·auto-publish 계약(GA-02) |
| [PR-27](./PR-27-candidate-model-and-trust-labels.md) | KnowledgeCandidate 모델·API + 신뢰 라벨 | T1 | 26 | 후보 1급 모델·API, 6종 신뢰 라벨 UI |
| [PR-28](./PR-28-enrichment-draft-agent.md) | Enrichment Draft Agent | T2 | 26,27 | create/enhance/skip/source-only, recipe 연결 |
| [PR-29](./PR-29-source-connector-interface.md) | Source Connector 인터페이스(구조·mock) | T2/T3 | 26 | 범용 Source 인터페이스, Slack/Drive/Meeting mock |
| [PR-30](./PR-30-conversation-ingest-backend.md) | Conversation Ingest API·Worker | T3 | 26,27,29 | 대화/회의록 후보 추출, 대화 provenance |
| [PR-31](./PR-31-conversation-save-ux.md) | Conversation Save UX | T3 | 30 | "대화에서 저장" 화면·흐름 |
| [PR-32](./PR-32-review-triage.md) | Review Triage(위험도 라우팅) | T4 | 26,27 | 완료(PR #44): needsReview 정책 결합, 승인 사유 inbox |
| [PR-33](./PR-33-knowledge-map.md) | Knowledge Map(링크 그래프 + 화면) | T5 | 26 | 완료(PR #45): Markdown 링크 그래프, `wkf visualize`, 지식 맵 화면 |
| [PR-34](./PR-34-discovery-trust-and-ask.md) | Discovery Trust + Ask 화면 | T6 | 26,27,33 | 완료(PR #46): 답변 출처·신뢰 표시, Q&A 화면 |
| [PR-35](./PR-35-simplification-cleanup.md) | Simplification Cleanup | T7 | 27~34 | 용어 일관화, 노출 정리, acceptance gate |

## 권장 구현 순서

1. **PR-26**(계약) — 모든 트랙의 어휘를 고정. 최우선.
2. **PR-27**(후보 모델·라벨) — 이후 PR이 의존하는 1급 모델.
3. **PR-29**(커넥터 구조) — 인입/대화 인입의 공통 입력 추상화. 27과 병행 가능.
4. **PR-28**(Enrichment Draft) → **PR-30/31**(대화 인입 백엔드/프런트).
5. **PR-32**(Review Triage) — 후보·정책 결합 후.
6. **PR-33**(지식 맵) — 독립적, 조기 PoC 데모 가치 큼(병행 가능).
7. **PR-34**(Discovery Trust + Ask) — 라벨·맵 이후.
8. **PR-35**(정리) — 마지막. 용어 매핑표는 [`contracts/terminology-map.md`](./contracts/terminology-map.md)에 조기 작성되어 PR-33부터 참조한다.

## 완료 기준 연결

본 PR 트랙이 모두 완료되면 [`Overview.md`](./Overview.md) §8의 완료 기준(후보/published 상태경계, Enrichment Draft 범위, 대화 provenance 정책, 지식 맵 v1 범위, PR 단위 계획, 용어 일관성)이 충족된다.
