# OKF Enrichment Product Flow — Overview

> 작성일: 2026-06-20
> 상태: 계획 수립 전 갭 분석 필요
> 목적: 기존 OKF/WKF 구현과 에이전트 자산을 유지하되, 사용자-facing 제품 흐름을 LLM Wiki식 "쉬운 지식화"로 재정렬한다.

---

## 1. 배경

현재 WekiFlow는 OKF 기반 WKF 포맷, 번들 동기화, reindex, curation, learner, discovery, MCP/connector 확장까지 상당 부분 구현했다. 그러나 제품 관점에서는 시스템이 파이프라인과 내부 용어 중심으로 커졌고, 팀·기업·대학 사용자가 기대하는 흐름은 더 단순하다.

사용자 목표는 다음에 가깝다.

1. 파일, 대화, 회의록, 위키, Drive 문서를 넣는다.
2. AI가 읽고 정리해 지식 후보를 만든다.
3. 사용자는 필요한 경우만 확인하거나 승인한다.
4. 지식은 계속 쌓이고, 질문 답변과 탐색에 재사용된다.
5. 중요한 조직 지식은 출처와 승인 상태를 가진다.

Google OKF의 핵심도 복잡한 플랫폼이 아니라 "Markdown + YAML frontmatter + 링크 + index/log"로 된 최소 지식 포맷이다. OKF reference `enrichment_agent`는 특정 BigQuery 도구가 아니라, "소스에서 OKF bundle 초안을 생성하고 보강하는 producer"의 예시로 보는 것이 맞다.

이 계획은 기존 구현을 버리는 것이 아니라, 역할 이름과 책임 경계를 제품 흐름 기준으로 다시 묶는 작업이다.

## 2. 목표 원칙

### 2.1 사용자에게 보일 모델

사용자는 OKF, WKF, Pipeline A/B/C/D, graph worker 같은 내부 개념을 몰라도 된다.

제품 표면은 다음 용어로 정리한다.

| 내부 개념 | 사용자-facing 용어 |
| :--- | :--- |
| OKF/WKF concept | 지식 카드 |
| raw source / reference | 원본 |
| enrichment/main agent | AI 정리 초안 |
| conversation learner | 대화에서 저장 |
| curation agent | 지식 정리 제안 |
| review gate | 승인 필요 |
| discovery agent | 지식에 질문하기 |
| learner proposal | 부족한 지식 |
| OKF bundle visualization | 지식 맵 |

### 2.2 지식화 정책

모든 인입은 우선 지식 후보가 된다. 단, 모든 후보가 곧 공식 지식은 아니다.

| 상태 | 의미 | 승인 |
| :--- | :--- | :--- |
| AI 정리됨 | AI가 원본을 읽고 생성한 초안 | 일반 지식은 자동 게시 가능 |
| 출처 확인됨 | claim이 원본/링크에 연결됨 | 낮은 위험이면 자동 게시 가능 |
| 승인 필요 | 정책, 규정, 계약, 보안, 가격, 학칙, 공식 답변 후보 | 사람 승인 필요 |
| 공식 지식 | 승인 또는 정책상 자동 통과된 published 지식 | 질문 답변 기본 근거 |
| 확인 필요 | 대화 기반이거나 출처가 약한 후보 | 답변 사용 시 표시 |
| 충돌 있음 | 기존 공식 지식과 모순 가능 | 승인 전 게시 금지 |

### 2.3 단순성 원칙

- OKF는 사용자 UX가 아니라 내부 저장·교환 포맷이다.
- `# Relations` 기반 typed graph는 고급 내부 인덱스로 유지하되, v1 UX는 Markdown 링크 기반 관계 탐색을 먼저 사용한다.
- 모든 쓰기에 엄격한 비축소/승인 정책을 적용하지 않는다. 기존 published 지식을 변경하는 curation-origin 경로에만 강하게 적용한다.
- 대화 내용은 공식 지식으로 직접 저장하지 않는다. 대화는 후보·결정사항·FAQ·누락 신호를 만든다.
- OKF bundle visualization은 diff 화면이 아니라 Markdown 링크로 구성된 지식 맵이다.

## 3. 새 역할 매핑

### 3.1 Enrichment Draft Agent

기존 Main/Ingest Agent를 제품 관점에서 재정의한다.

역할:
- 파일, URL, Drive, 회의록, 기존 문서, 수동 입력을 읽는다.
- 요약, 핵심 사실, 질문 후보, 태그, 관련 문서 링크, 출처를 만든다.
- 결과를 `KnowledgeCandidate` 또는 WKF draft로 저장한다.
- 기존 지식과 중복·충돌 가능성을 표시한다.

현재 대응:
- `buildIngestPrompt`
- `MAIN_AGENT_SYSTEM_PROMPT`
- `tool_merge`
- `tool_verify_integrity`
- `wkf regenerate` / `recipe.yaml`

변경 방향:
- "기존 문서에 병합"만이 아니라 "새 지식 후보 생성"을 1급 흐름으로 만든다.
- Google OKF `enrichment_agent`의 `enhance/create/skip` 결정을 신규 인입에도 적용한다.
- BigQuery 중심이 아니라 범용 `Source { list(); fetch(ref): text }` 커넥터 모델로 확장한다.

### 3.2 Conversation Ingest Agent

대화형 인입 전담 역할로 둔다.

역할:
- 사용자가 대화 중 "이거 저장해", "이걸 우리 규칙으로 기억해"라고 할 때 후보를 만든다.
- 회의록/채팅에서 결정사항, 정책성 발언, 반복 질문, TODO를 추출한다.
- 출처가 대화뿐이면 `확인 필요`로 표시한다.
- 공식화에는 담당자 승인 또는 원본 문서 연결을 요구한다.

현재 대응:
- `learnerJudge`
- `WkfEnrichmentProposal`
- `jobs.agentSteps`

변경 방향:
- 기존 learner를 "실패 궤적 분석"에만 묶지 말고, 대화형 지식 후보 생성에도 재사용한다.
- 대화 기반 후보에는 `conversationQuote`, `speaker`, `createdFromConversation`, `needsSource` 같은 provenance를 둔다.

### 3.3 Curation Agent

기존 published 지식 유지보수 담당이다.

역할:
- 오래된 지식을 재검증한다.
- 원본 변경 또는 새 출처와의 충돌을 감지한다.
- 기존 문서를 통째로 다시 쓰지 않고 가산적 보강안만 만든다.
- 변경 없음도 `last_verified`와 log로 기록한다.

현재 대응:
- `workers/curation`
- `tool_read_concept`
- `tool_grep_verify`
- `tool_fetch_url`
- `tool_write_concept`
- `assertNoShrinkage`

변경 방향:
- 사용자-facing 이름은 "지식 정리 제안"으로 둔다.
- 자동 게시보다 "변경안 제안 + 필요한 경우 승인"을 기본 UX로 둔다.
- external enrichment는 opt-in이고, allowlist와 max pages는 도구 레이어에서 강제한다.

### 3.4 Discovery Agent

질문 답변과 탐색 담당이다.

역할:
- 공식 지식과 출처 확인 지식을 우선 검색한다.
- 확인 필요 후보를 사용하면 답변에 표시한다.
- 링크와 backlinks를 사용해 관련 지식을 제안한다.
- 답변 실패는 Learner/Conversation 흐름으로 되돌린다.

현재 대응:
- `/api/ask`
- `tool_discovery_agent`
- `tool_hybrid_retrieve`
- `tool_search_graph`

변경 방향:
- 관계형 질문도 처음부터 typed KG만 강제하지 않는다.
- Markdown 링크, backlinks, tags, heading, source citation을 1차 탐색 단서로 사용한다.
- typed graph는 정확한 멀티홉 관계가 필요한 경우의 내부 고급 인덱스로 둔다.

### 3.5 OKF Bundle Visualizer

diff visualizer가 아니라 Markdown 링크 기반 지식 맵이다.

Google OKF repo의 `visualize` subcommand는 OKF bundle을 단일 `viz.html`로 렌더한다. 표시 항목은 개념 노드, Markdown cross-link edge, frontmatter, body rendering, backlinks, search, type filter, layout switch다.

WekiFlow 적용 방향:
- `wkf visualize <bundle>` 또는 API 기반 "지식 맵" 화면을 만든다.
- v1은 OKF 링크와 문서 관계를 보여준다.
- `# Relations` typed KG는 별도 고급 레이어로 토글한다.
- 고객 PoC에서는 "AI가 정리한 조직 지식이 어떻게 연결됐는가"를 보여주는 신뢰/탐색 UI로 쓴다.

## 4. 목표 아키텍처

```text
Sources
파일 / URL / Drive / 대화 / 회의록 / 기존 위키
  |
  v
Enrichment Draft Agent
요약 / 핵심 사실 / Q&A / 태그 / 링크 / 출처 / 충돌 후보
  |
  v
Knowledge Candidates
AI 정리됨 / 출처 확인됨 / 확인 필요 / 승인 필요 / 충돌 있음
  |
  v
Light Review
자동 통과 / 사람 승인 / 출처 요청 / 반려 / 보류
  |
  v
Published Knowledge Wiki
OKF-compatible Markdown bundle + DB derived indexes
  |
  v
Ask / Search / Knowledge Map / Export / MCP
```

중요한 구조 결정:
- source 원본과 published knowledge를 분리한다.
- OKF bundle은 장기 보존과 에이전트 소비를 위한 표준 표현이다.
- MongoDB, vector index, KG는 검색 성능을 위한 derived index다.
- 승인 UX는 모든 문서가 아니라 위험도 높은 변경만 대상으로 한다.

## 5. 현재 구현과 목표 사이 갭

### 5.1 백엔드 갭

1. **인입 결과 모델이 "문서 병합"에 치우쳐 있음**
   - 현재 Main Agent는 기존 문서 병합 초안 중심이다.
   - 새 목표는 신규 후보 생성, 기존 보강, skip, source-only 저장을 모두 지원해야 한다.

2. **KnowledgeCandidate 1급 모델 부재**
   - `documents.status`는 존재하지만 사용자-facing 후보 상태와 provenance가 부족하다.
   - `AI 정리됨`, `출처 확인됨`, `확인 필요`, `승인 필요`, `충돌 있음`을 표현할 모델이 필요하다.

3. **Conversation ingest 경로 부재**
   - learner는 agentSteps 기반 gap proposal에 가깝다.
   - 사용자의 대화/회의록/채팅에서 지식 후보를 생성하는 명시적 API와 워커가 필요하다.

4. **OKF 링크 기반 지식 맵 산출물 부재**
   - `# Relations`와 KG는 있지만, 일반 Markdown cross-link graph를 사용자-facing map으로 렌더하는 경로가 없다.
   - `wkf visualize` 또는 web graph API가 필요하다.

5. **`wkf regenerate`는 아직 product enrichment로 부족**
   - 현재 recipe 기반 deterministic draft 산출은 placeholder 성격이 강하다.
   - 실제 enrichment draft agent와 연결해 recipe 재실행이 후보 생성으로 이어져야 한다.

6. **승인 정책이 제품 위험도 기준으로 단순화되지 않음**
   - policy engine은 구현돼 있지만 사용자-facing 기준이 내부 `source_tier`, role, type 중심이다.
   - 위험도 기반 `needsReview` 산정 규칙이 필요하다.

7. **출처·대화 provenance 세분화 부족**
   - 파일/URL 출처와 대화 발화 근거를 구분해야 한다.
   - 대화 기반 후보는 공식 지식과 다르게 취급되어야 한다.

### 5.2 프런트엔드 갭

1. **사용자 흐름이 인입/정리/승인으로 단순화되어 있지 않음**
   - 내부 상태와 검토 화면은 있으나 "AI가 정리한 후보" 중심 UX가 필요하다.

2. **대화에서 지식 저장 UX 부재**
   - 채팅 또는 회의록 화면에서 "지식으로 저장", "후보로 올리기", "출처 필요" 흐름이 필요하다.

3. **Review 화면이 위험도 기반 triage를 보여주지 않음**
   - 모든 draft diff보다 "왜 승인 필요인지"를 보여주는 카드가 필요하다.
   - 예: 정책성 내용, 출처 없음, 기존 공식 지식과 충돌, 외부 공개 가능성.

4. **Knowledge Map 화면 부재**
   - OKF visualizer식 graph/detail/search/filter/backlinks 화면이 필요하다.
   - v1은 Markdown 링크 기반, advanced toggle로 typed relations를 추가한다.

5. **출처와 신뢰 라벨 표시 부족**
   - 답변, 지식 카드, 후보 카드에 `AI 정리됨`, `출처 확인됨`, `공식 지식`, `확인 필요`가 일관되게 표시되어야 한다.

6. **일반 사용자가 OKF/WKF를 볼 필요가 없음**
   - raw Markdown/source는 고급 보기로 남기고, 기본 화면은 지식 카드와 출처 중심이어야 한다.

## 6. 갭 분석 단계 제안

상세 PR 계획을 쓰기 전에 다음 갭 분석 문서를 먼저 작성한다.

### GA-01. Current Flow Inventory

목표:
- 파일 인입, 수동 추가, 검토, Q&A, curation, learner, bundle sync의 실제 API/DB/UI 흐름을 추적한다.

산출:
- 현재 데이터 흐름 다이어그램
- 사용자-facing 화면 목록
- 현재 status/state enum 목록
- `documents`, `enrichment_proposals`, `jobs.agentSteps`, WKF bundle 간 매핑표

### GA-02. Target Product Flow Contract

목표:
- 사용자-facing 지식화 상태와 승인 규칙을 확정한다.

산출:
- `KnowledgeCandidate` 상태 기계
- 위험도 기반 `needsReview` 규칙
- 대화 기반 후보 provenance 규칙
- 자동 게시 가능 조건

### GA-03. Backend Architecture Gap

목표:
- 기존 Main/Curation/Learner/Discovery를 새 역할로 재매핑한다.

산출:
- Enrichment Draft Agent 설계
- Conversation Ingest Agent 설계
- Candidate 저장 모델
- recipe/regenerate와 인입 파이프라인 통합 방식
- OKF link graph extraction API 설계

### GA-04. Frontend UX Gap

목표:
- 사용자 흐름을 "넣기 → AI 정리 → 확인/승인 → 질문/탐색"으로 재설계한다.

산출:
- Add/Import 화면 개편안
- Candidate inbox / review triage 화면 설계
- Conversation save flow 설계
- Knowledge Map 화면 설계
- 신뢰 라벨 UI 규약

### GA-05. Migration and Simplification Plan

목표:
- 이미 구현된 OKF 고급 기능을 유지하면서 사용자-facing 복잡도를 줄인다.

산출:
- 유지할 기능 / 숨길 기능 / 이름 바꿀 기능 / 제거 후보 목록
- PR 단위 구현 순서
- 회귀 테스트 및 acceptance gate

## 7. 예상 PR 트랙 초안

상세 PR 문서는 갭 분석 후 작성한다. 현재 예상 트랙은 다음과 같다.

| 트랙 | 주제 | 백엔드 | 프런트엔드 |
| :--- | :--- | :--- | :--- |
| T1 | Candidate 모델 | 상태/위험도/provenance 스키마, API | 후보 카드, 신뢰 라벨 |
| T2 | Enrichment Draft Agent | main agent 재정의, create/enhance/skip, recipe 통합 | 인입 결과 화면 |
| T3 | Conversation Ingest | 대화/회의록 후보 추출 API·worker | "대화에서 저장" UX |
| T4 | Review Triage | needsReview 정책, approval routing | 승인 사유 중심 inbox |
| T5 | Knowledge Map | OKF Markdown link graph 추출, `wkf visualize` 또는 graph API | 지식 맵 화면 |
| T6 | Discovery Trust | 답변 출처·신뢰 상태 반영 | 답변에 라벨/출처 표시 |
| T7 | Simplification Cleanup | 내부 pipeline terminology 정리 | OKF/WKF 노출 최소화 |

## 8. 완료 기준

이 Overview의 후속 상세 계획이 완료되려면 다음이 충족되어야 한다.

- [ ] 현재 인입/검토/Q&A/curation/learner 흐름의 실제 코드 경로가 문서화되어 있다.
- [ ] `KnowledgeCandidate`와 published knowledge의 상태/승인 경계가 확정되어 있다.
- [ ] Enrichment Draft Agent가 현재 Main Agent를 대체/흡수하는 범위가 확정되어 있다.
- [ ] Conversation Ingest의 저장 정책과 provenance 정책이 확정되어 있다.
- [ ] OKF Markdown link 기반 Knowledge Map의 v1 범위가 확정되어 있다.
- [ ] 백엔드/프런트 PR 단위 계획 문서가 작성되어 있다.
- [ ] 사용자-facing 용어가 확정되어 UI 문구와 docs에서 일관되게 사용된다.

## 9. 참고 근거

- Google OKF blog: https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing
- Google OKF spec: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
- Google OKF enrichment/visualize README: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/README.md
- LLM Wiki pattern: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
- WekiFlow WKF spec: [`../../reference/okf-knowledge-standard/04-wekiflow-knowledge-spec.md`](../../reference/okf-knowledge-standard/04-wekiflow-knowledge-spec.md)
- WekiFlow curation agent: [`../../reference/okf-knowledge-standard/05-curation-agent.md`](../../reference/okf-knowledge-standard/05-curation-agent.md)
- WekiFlow format/recipe docs: [`../../reference/okf-knowledge-standard/07-knowledge-format-and-generation.md`](../../reference/okf-knowledge-standard/07-knowledge-format-and-generation.md)
- WekiFlow learner/discovery docs: [`../../reference/okf-knowledge-standard/08-agent-implementation-specs.md`](../../reference/okf-knowledge-standard/08-agent-implementation-specs.md)
- WekiFlow enrichment harness docs: [`../../reference/okf-knowledge-standard/09-enrichment-harness-and-mdcode.md`](../../reference/okf-knowledge-standard/09-enrichment-harness-and-mdcode.md)
