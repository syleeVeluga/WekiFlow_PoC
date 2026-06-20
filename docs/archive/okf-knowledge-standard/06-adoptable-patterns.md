# 06. 채용 가능한 패턴 카탈로그 — agents / toolbox / samples 정밀 검토

> knowledge-catalog 저장소의 `agents/`·`toolbox/`·`samples/`를 면밀히 훑어 **실제 구현 계획에 바로 쓸 수 있는 패턴**을 우선순위와 함께 정리한다.
> 각 패턴은 **무엇인가 → 구체 메커니즘 → WekiFlow 채용 방법 → 어느 Phase/파일에 → 우선순위** 순으로 기술.
> ⚠️ 모두 Python/Google ADK·GCP(Dataplex/BigQuery/Vertex) 기반이라 **드롭인 불가, 설계·프로토콜 레퍼런스**. 우리 TS/AI SDK/BullMQ/MongoDB로 재구현한다.

---

## 0. 저장소 전체 지도 (Repo Map)

| 경로 | 정체 | 우리에게의 가치 |
| :--- | :--- | :--- |
| `okf/` | Open Knowledge Format 스펙·번들·enrichment agent | ★★★ (문서 01·04·05에서 분석 완료) |
| **`toolbox/mdcode/`** | **"Metadata as Code"** — 메타데이터를 git 아티팩트로, 카탈로그와 양방향 동기화(`kcmd`) | ★★★ SoT 역전의 *동기화 프로토콜* 제공 |
| `toolbox/enrichment/` | 메타데이터 produce/evolve/maintain 하니스 | ★★ 파이프라인 C 확증(문서 05) |
| **`agents/mdcode/`** | mdcode를 구동하는 에이전트(MCP 서버 내장, `--format okf`) | ★★★ 에이전트가 git 메타데이터를 자율 조작 |
| **`agents/conversation_learner/`** | 대화 trajectory를 LLM-as-judge로 평가 → 지식 격차/할루시네이션 탐지 → 보강 제안 | ★★★ **피드백 기반 갱신**(새 축) |
| `agents/enrichment/` | enrichment 에이전트(okf와 유사 계열) | ★★ (문서 05와 중복) |
| **`samples/discovery/`** | 검색/발견 에이전트 — 질문 분해→다중쿼리→리랭크 | ★★ 질의측(Q&A) 검색 품질 업그레이드 |
| `samples/enrichment/` | enrichment 데모 | ★ |

→ 신규 채용 후보 **4가지**(mdcode 동기화 / reference 베이스라인 / conversation_learner / discovery)를 아래에서 상세화.

---

## 1. ★★★ Metadata-as-Code 동기화 프로토콜 (mdcode) — SoT 역전의 *구현 청사진*

### 무엇인가
메타데이터를 클라우드 콘솔이 아니라 **버전관리되는 YAML+Markdown 아티팩트**로 다루고, 카탈로그 서비스와 **양방향 동기화**한다. 우리의 "SoT를 git 번들로 역전"([`03` §2](./03-proposal.md))을 *이미 구현한* 사례 — 막연한 아이디어가 아니라 **검증된 동기화 프로토콜**을 그대로 베낄 수 있다.

### 구체 메커니즘 (그대로 채용)
- **파일 레이아웃:** `catalog.yaml`(매니페스트: 범위·alias·스냅샷·발행설정) + `<entry-id>.yaml`(정형 엔트리) + `<entry-id>.aspect.md`(사이드카: frontmatter `userManaged`/links + 본문). **`--format okf` 플래그로 OKF 번들 구조 출력** ← 우리 WKF가 OKF superset이라는 설계와 정합.
- **멀티 레이아웃:** 데이터 자산=YAML, 지식베이스=Markdown. → 우리도 "정형 데이터는 frontmatter, 지식 본문은 MD"로 자연스럽게 매핑.
- **CLI 명령:** `kcmd init`(스냅샷 초기화) / `pull`(서비스→로컬) / `push`(로컬→서비스) / `status`(로컬 변경 탐지). 모두 `--dry-run` 지원.
- **낙관적 락(Optimistic Locking) — ★ 핵심:** *"push는 마지막 pull 이후의 변경분만 보내고, 그 사이 카탈로그에서 해당 메타데이터가 수정되지 않았을 때만 성공"*. `pull`은 미반영 변경이 있으면 충돌 보고. → **동시 편집(사람 vs 에이전트) 클로버 방지를 위한 정확한 기법.** 우리 제안([`03` §8])의 "멱등 보장"을 *어떻게* 보장할지에 대한 답.
- **Safe Push Reconciliation:** 정규화된 타깃 매칭 + 변경 없는 관계 보존. → 우리 `# Relations`/Entity Resolution 재빌드의 멱등 재조정과 동형.
- **git-native:** 커밋 이력·브랜치·푸시 전 코드리뷰.

### WekiFlow 채용
- `wkf export`/`reindex`([`04` §8])를 **`wkf status`/`pull`/`push` 3종 + 낙관적 락**으로 격상. `documents`에 `lastPulledRev`(or content hash)를 두고, 승인 커밋 시 "그 사이 DB가 안 바뀐 경우만" 번들에 반영.
- `--dry-run`을 검토 UI에 노출(승인 전 영향 미리보기).
- 매니페스트(`wkf.yaml`)로 번들 범위·발행 설정을 선언(= 우리 `policy.yaml`과 통합 가능).

### 어디에 → Phase 6 (SoT 역전). 우선순위 **최상**.

---

## 2. ★★★ Reference 베이스라인(`.ref.yaml`) — *변형 없는 그라운딩*

### 무엇인가
mdcode 에이전트는 **읽기 전용 기준 데이터**(`.ref.yaml` 사이드카)를 따로 pull해, enrichment의 *근거(grounding)* 로 쓰되 **절대 덮어쓰지 않는다**("Grounding without mutation").

### 왜 우리에게 결정적인가
파이프라인 C(큐레이션 에이전트)의 최대 리스크는 **파괴적 재작성**([`05` §3]). reference 레이어는 그 완화책의 한 조각: 에이전트가 "권위 있는 원본"을 read-only로 들고 비교만 하고, 쓰기는 가산적으로만. 우리 **샌드박스 read-only `/docs` 마운트**(`docs/05-sandbox-security`)와 철학이 정확히 같다 — 이미 절반은 갖고 있다.

### WekiFlow 채용
- 큐레이션 에이전트가 갱신 대상 개념의 **현재 published 버전을 `.ref`(읽기전용)** 로 컨텍스트에 주입 → diff 기반 가산 보강만 허용, 원본 변형 차단.
- `tool_grepVerify`의 read-only 마운트를 reference 레이어로 일반화.

### 어디에 → Phase 7 (파이프라인 C 보강). 우선순위 **상**.

---

## 3. ★★★ Conversation Learner — *피드백 기반 갱신* (새 축)

### 무엇인가
**LLM-as-a-judge가 대화 trajectory(에이전트 실행 궤적)를 평가**해 마찰(friction)·할루시네이션을 탐지하고, **지식 격차를 `ContextEnrichmentProposal` 레코드로 생성**한다.

### 구체 메커니즘
- **데이터 소스:** Cloud Logging의 최근 대화 trajectory(OpenTelemetry `gen_ai.*` 트레이스). → 우리에겐 이미 **`jobs.agentSteps`**(도구 호출 추적, `docs/03` §5)가 동일 역할.
- **Trajectory Analysis:** 대화 턴을 평가해 detection signals·gaps 추출 → `ContextEnrichmentProposal` → `proposal.json` 저장.
- (관찰) **사람 검증 워크플로는 명시 안 됨** — 우리는 검토 게이트로 보완하면 OKF보다 강함.

### 왜 새 축인가
지금까지 우리 갱신 트리거는 **이벤트(A·인입)** + **스케줄(C·신선도)** 두 가지. Learner는 **피드백(실사용 실패에서 역으로 학습)** 이라는 **세 번째 트리거**다. 우리는 이걸 거의 *공짜로* 만들 수 있다 — 이미 `jobs.agentSteps`에 신호가 쌓이고 있으니:

| Learner가 보는 신호 | 우리 `agentSteps`의 대응 | 함의 |
| :--- | :--- | :--- |
| 할루시네이션 | `tool_verify_integrity` `allVerified=false` | 문서에 근거 부재 → 보강 필요 |
| 마찰/탐색 실패 | `tool_search_vector` 저점수, grep 반복 | 지식 격차 → 신규 문서 후보 |
| 멀티홉 실패 | `tool_search_graph` 빈 경로 | 관계(`# Relations`) 누락 |

### WekiFlow 채용
- **파이프라인 D(러너, 선택)** 신설 또는 파이프라인 C에 흡수: 주기적으로 `jobs.agentSteps`를 LLM-judge로 분석 → `EnrichmentProposal`(어떤 개념이 약한가/무엇이 빠졌나) 생성 → 검토 큐 또는 C의 우선순위 입력.
- 산출물은 사람 승인 게이트를 거쳐 인입(A)/큐레이션(C)으로 환류 → **선순환 강화**.

### 어디에 → Phase 7 직후 또는 별도 Phase 8. 우선순위 **상**(투자 대비 효과 큼, 신호 인프라가 이미 존재).

---

## 4. ★★ Discovery 에이전트 — 질의측 검색 품질 업그레이드

### 무엇인가
단순 의미검색을 넘어 **질문의 의미 분해(semantic decomposition)** 를 수행: 복잡한 질문 → 여러 검색 쿼리 생성 → AI 리랭크 → 종합 답변.

### 구체 메커니즘
1. **분해(Decomposition):** 복합 질문을 구성요소로 분할
2. **다중 쿼리 생성(Multi-query):** 분해 결과로 여러 검색 쿼리 발행
3. **리랭크(Rerank):** AI 기반 재정렬로 종합 답변
- **배포 유연성:** 독립 root agent로도, 부모 에이전트의 **`AgentTool`(서브에이전트)로 합성**도 가능.

### 왜 우리에게 유용한가
현 WekiFlow 도구는 전부 **인입측**(검색→병합). **질의측(end-user Q&A) 전용 에이전트가 없다.** 또 `docs/22`에서 "멀티 에이전트 없음"이라 했는데, `AgentTool` 합성 패턴이 깔끔한 도입 경로를 준다.

### WekiFlow 채용
- `tool_hybrid_retrieve`(벡터+그래프 RRF) 앞단에 **질문 분해 + 다중 쿼리** 단계 추가 → 복합 규정 질문("영업팀 신입 출장 범위?")의 재현율↑.
- end-user용 **Discovery Agent**를 `ToolLoopAgent`로 추가하되, 인입 에이전트의 `AgentTool`로도 노출(재사용).
- 리랭크는 Vertex 대신 우리 모델/`cosineSimilarity`+그래프 degree로 자체 구현.

### 어디에 → Phase 4(Hybrid RAG, `docs/10`) 확장. 우선순위 **중상**.

---

## 5. ★★ MCP 서버로 지식 노출 (mdcode 공통)

### 무엇인가
mdcode는 CLI 외에 **MCP 서버**를 제공해, 자율 에이전트가 메타데이터를 표준 도구로 "list, lookup, modify autonomously" 한다. TS/Python 라이브러리도 제공.

### WekiFlow 채용 (전략적)
- WKF 번들을 **MCP 서버로 노출** → 외부 에이전트/IDE(예: Claude Code, Cursor)가 우리 조직 지식을 표준 프로토콜로 읽고(읽기 우선) 제안. 사내 지식의 *배포 표면* 확장.
- 쓰기는 검토 게이트 뒤에서만.

### 어디에 → Phase 7+ (선택, 생태계 연동). 우선순위 **중**(가치 크나 비핵심).

---

## 6. 채용 안 하거나 치환할 것 (Non-adoptable / Substitute)

| 항목 | 처분 | 대체 |
| :--- | :--- | :--- |
| Dataplex/BigQuery 결합 | ❌ | MongoDB + MinIO(우리 데이터 계층) |
| Vertex AI 리랭크 | ❌ | 자체 모델 + `cosineSimilarity` + 그래프 degree |
| Cloud Logging / Reasoning Engine trace | ❌ | `jobs.agentSteps` + pino(이미 보유) |
| Google ADK / Python | ❌ | Vercel AI SDK `ToolLoopAgent` / TS |
| `kcmd` CLI 그 자체 | ❌ | `wkf` CLI로 *프로토콜만* 차용(낙관적 락 등) |

---

## 7. 채용 우선순위 요약 & 로드맵 반영

| # | 패턴 | 우선 | 슬롯(Phase) | 기존 자산 재사용 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | **Metadata-as-Code 동기화(낙관적 락)** | 최상 | 6 | `documents.version` → rev/hash |
| 2 | **Reference 베이스라인 그라운딩** | 상 | 7 | 샌드박스 read-only 마운트 |
| 3 | **Conversation Learner(피드백 갱신)** | 상 | 7~8 | **`jobs.agentSteps`(이미 존재)** |
| 4 | **Discovery(질문분해+다중쿼리+리랭크)** | 중상 | 4 확장 | `tool_hybrid_retrieve` |
| 5 | **MCP 서버 노출** | 중 | 7+ | WKF 번들 |

### 기존 로드맵([`03` §7])에 추가 반영
- **Phase 6**(SoT 역전)에 → 패턴 1·2를 *구현 방식*으로 채택(낙관적 락 sync, `--dry-run`, reference 레이어).
- **Phase 7**(정책·지속업데이트)에 → 패턴 2·3 통합. 파이프라인 C에 reference 그라운딩, **러너(피드백 루프)** 를 C의 우선순위 입력으로.
- **Phase 4**(Hybrid RAG) 확장에 → 패턴 4(discovery)로 질의 품질 강화.
- **Phase 7+** 선택 → 패턴 5(MCP) 생태계 연동.

---

## 8. 한 줄 요약

> mdcode가 우리 **SoT 역전의 동기화 프로토콜(낙관적 락·reference 그라운딩)** 을 검증해 주고, conversation_learner가 **피드백 기반 갱신이라는 새 축**을, discovery가 **질의측 검색 품질**을 더해 준다. 셋 다 GCP/ADK 종속이라 재구현이 필요하지만, **설계·프로토콜·프롬프트는 곧바로 차용 가능**하며 상당 부분은 우리가 *이미 가진 자산*(agentSteps, read-only 샌드박스, hybrid_retrieve) 위에 얹힌다.
