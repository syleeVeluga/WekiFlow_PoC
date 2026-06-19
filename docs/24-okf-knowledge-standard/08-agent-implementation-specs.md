# 08. 에이전트 구현 스펙 — Feedback Learner & Discovery (TS 재구현)

> `agents/conversation_learner`·`samples/discovery`의 **실제 스키마·프롬프트·도구 시그니처**를 코드 레벨로 분석해, WekiFlow(Vercel AI SDK `ToolLoopAgent` / MongoDB / BullMQ)로 **재구현 가능한 스펙**으로 옮긴다.
> 원본은 Python/Google ADK·Dataplex 종속 → 우리 자산(`jobs.agentSteps`·`tool_hybrid_retrieve`)에 매핑.

---

# A. Feedback Learner — 피드백 기반 지식 갱신 (★ 새 축)

원본: `agents/conversation_learner` — *"LLM-as-a-judge over conversational trajectories to detect friction and hallucination"*. 대화 궤적을 평가해 **지식 격차/할루시네이션을 탐지**하고 보강 제안을 생성한다.

## A.1 원본 핵심 스키마 (verbatim, Pydantic)

```python
class DetectionSignal(str, Enum):       # "어떻게 알았나" (행동 증거)
    DIRECT_USER_CORRECTION; IMPLICIT_USER_FRICTION
    AGENT_SELF_REFLECTION; USER_SATISFACTION

class GapType(str, Enum):                # "무엇이 빠졌나" (근본 원인)
    LEXICAL_SYNONYM_GAP; BUSINESS_LOGIC_GAP
    STRUCTURAL_ROUTING_GAP; UNCATALOGED_ASSET_DISCOVERY; VALIDATED_CONTEXT

class EnrichmentAction(str, Enum):       # "무엇을 할까"
    UPDATE_OVERVIEW_ASPECT; FLAG_FOR_CATALOGING; BOOST_CONFIDENCE

class ContextEnrichmentProposal(BaseModel):
    classification: {detection_signal, gap_type}
    target_asset: {type: TABLE|COLUMN|GLOSSARY_TERM|UNCATALOGED_ASSET, name}
    current_context_flaw: Optional[str]          # 에이전트가 뭘 잘못 가정/누락했나
    proposed_enrichment: {action, value}          # 적용할 정확한 동의어/공식/설명
    evidence: {reasoning, trajectory_quote}       # 감사용 원문 인용
    confidence_grade: float (0..1)
    eval_candidate: {is_valid_candidate, user_query_intent, golden_sql}  # 회귀 평가 후보
    enrichment_agent_instruction: str             # 실행 에이전트용 명령(배경 제외)
```

핵심 설계 통찰:
- **이중 분류:** *증거(detection_signal)* 와 *원인(gap_type)* 을 분리. "어떻게 알았는지"와 "무엇을 고칠지"를 따로 둠.
- **감사 가능:** `evidence.trajectory_quote`로 사람(데이터 스튜어드)이 검증.
- **회귀 평가 후보 동시 추출:** 성공한 (질문→SQL)을 `eval_candidate`로 저장 → 미래 회귀 테스트 골든셋.
- **PII 레닥션 규칙**과 "정확히 1회 save 호출 후 중단" 같은 운영 가드레일이 프롬프트에 포함.

## A.2 WekiFlow 매핑 — 우리는 신호가 이미 있다

원본은 Cloud Logging trajectory를 읽지만, 우리는 **`jobs.agentSteps`**(도구 호출 추적, `docs/03` §5)에 동일 신호가 쌓인다:

| 원본 DetectionSignal/GapType | WekiFlow `agentSteps` 신호 | 도출되는 제안 |
| :--- | :--- | :--- |
| AGENT_SELF_REFLECTION + 할루시네이션 | `tool_verify_integrity.allVerified=false` | 문서에 근거 부재 → `# Facts`/`# Citations` 보강 |
| STRUCTURAL_ROUTING_GAP | `tool_search_graph` 빈 경로 | 관계 누락 → `# Relations` 추가 |
| LEXICAL_SYNONYM_GAP | `tool_search_vector` 저점수 후 grep 성공 | 동의어/별칭 누락 → `aliases`/태그 보강 |
| UNCATALOGED_ASSET_DISCOVERY | grep이 트리 밖 파일 적중 | 미등록 지식 → 신규 문서 후보(FLAG) |
| VALIDATED_CONTEXT | 1트라이 성공 | 신뢰도 부스트(재검증 우선순위↓) |

## A.3 WKF 적응 스키마 (TS / zod)

```ts
// packages/agent-tools/src/learner.ts
export const WkfEnrichmentProposal = z.object({
  classification: z.object({
    detectionSignal: z.enum(['VERIFY_FAILED','GRAPH_MISS','VECTOR_LOW_THEN_GREP','OFFTREE_HIT','FIRST_TRY_OK']),
    gapType: z.enum(['MISSING_CITATION','MISSING_RELATION','SYNONYM_GAP','UNCATALOGED','VALIDATED']),
  }),
  targetConcept: z.object({ slug: z.string(), section: z.enum(['Facts','Relations','Citations','frontmatter']).optional() }),
  currentFlaw: z.string().nullable(),
  proposed: z.object({ action: z.enum(['ENRICH_DOC','FLAG_NEW_DOC','BOOST_CONFIDENCE']), value: z.string() }),
  evidence: z.object({ reasoning: z.string(), stepQuote: z.string() }),  // agentSteps에서 인용
  confidence: z.number().min(0).max(1),
  evalCandidate: z.object({ valid: z.boolean(), intent: z.string().nullable(), goldenAnswer: z.string().nullable() }),
  instruction: z.string(),   // 큐레이션 에이전트(C)용 실행 명령
});
```

## A.4 파이프라인 D(러너) 동작 + 적응 프롬프트

```
[1] 스케줄(cron) 또는 잡 완료 훅 → 최근 jobs.agentSteps 묶음 로드
[2] LLM-judge가 궤적 평가 → WkfEnrichmentProposal[] (없으면 빈 배열)
[3] proposals → 검토 큐(사람 승인) 또는 파이프라인 C 우선순위 입력
[4] evalCandidate → 회귀 골든셋에 적재(검색 품질 회귀 감지)
```

적응 시스템 프롬프트(원본 차용):
```
너는 WekiFlow 지식 평가자다. 에이전트 실행 궤적(jobs.agentSteps: 도구 호출·검색 점수·검증 결과)을
평가해 지식 격차를 찾는다. 각 격차에 대해 detectionSignal(어떻게 알았나)과 gapType(무엇이 빠졌나)을
모두 분류하라.
- verify 실패 → 근거/인용 부재. graph 빈 경로 → 관계 부재. vector 저점수→grep 성공 → 동의어 부재.
- evidence.stepQuote에 정확한 궤적 인용을 남겨 사람이 검증하게 하라.
- 성공한 (질문→답)은 evalCandidate로 추출해 회귀 골든셋 후보로 남겨라.
- instruction에는 큐레이션 에이전트가 실행할 명령만 담고 배경/추론은 빼라.
- 격차가 없으면 빈 배열을 반환하라. PII는 [REDACTED] 처리하라.
```

> **가치:** 투자 대비 효과 최상 — 신호 인프라(`agentSteps`)가 *이미 존재*하므로, judge 1개 + 스키마 1개 + 검토 큐 연결이면 **"실사용 실패에서 역으로 배우는"** 세 번째 갱신 축이 완성된다. 슬롯: Phase 7~8([`06` §3]).

---

# B. Discovery — 질의측 검색 에이전트 (검색 품질 업그레이드)

원본: `samples/discovery` — 단순 의미검색을 넘어 **질문 의미 분해 → 다중 쿼리(scatter-and-gather) → 중복제거 → 리랭크**.

## B.1 원본 핵심 프롬프트 (verbatim 요지, `SKILL.md`)

```
Step 2: 의미 분해 & 변형 생성
- 핵심 엔티티/지표/제약(타입·시스템)으로 분해.
- "데이터 엔지니어처럼 생각": 비즈니스어 → 저장 용어로 번역
  (예: "고객 획득" → "revenue","billing","subscriptions","accounts").
- 최대 3개의 DISTINCT 검색 변형 생성(중복 금지):
   변형1 직접+동의어 / 변형2 데이터소스 용어 번역 / 변형3 상위 카테고리·연관 지표.
- 제약을 predicate로 추출(예: "project foo" → projectid=foo).

Step 3: 검색 도구 호출(배칭)
- 변형들과 함께 Baseline Search(사용자 원문 그대로)를 반드시 포함. 병렬 배칭.

Step 4: 결과 병합 — entry name 동일이면 중복 제거.
Step 5: 최적 결과 선별 — 관련성 정렬, 무관한 것 필터, 가장 관련 높은 것 상위.
```

운영 규칙(채용 가치 큼):
- **명확화 질문 먼저 하지 말고 일단 검색** ("always attempt a search first").
- **Baseline(원문) + 변형 N**을 항상 함께 — 분해가 원문 의도를 놓치는 것 방지.
- 결과는 **entry name만** 반환(설명 없이) — 토큰 절약·결정성.

## B.2 도구 시그니처 (원본)

```python
def knowledge_catalog_search(query: str) -> {"results": [{entry_name, system, resource_id, display_name}]}
# Dataplex CatalogServiceClient.search_entries(semantic_search=True, page_size=50)
```
predicate 시스템: `type= / system= / name: / displayname: / projectid= / parent=` (+ AND/OR/부정 `-`).

## B.3 WekiFlow 매핑

| 원본 | WekiFlow |
| :--- | :--- |
| `knowledge_catalog_search`(Dataplex 의미검색) | 우리 `tool_hybrid_retrieve`(벡터+그래프 RRF, `docs/22`) |
| predicate(`projectid=`,`type=`) | 우리 필터: `documentId`/`status`/`tags`/트리 경로(slug prefix) |
| Vertex 리랭크 | 자체: RRF 점수 + `kg_nodes.degree` + grep 검증 보너스 |
| AgentTool 합성 | 인입 에이전트가 Discovery를 `tool`로 호출 |

## B.4 WekiFlow Discovery 스펙 (질의측 신규 에이전트 + 기존 도구 강화)

**(a) 검색 전처리 강화** — `tool_hybrid_retrieve` 앞단에 분해 단계 추가:
```ts
// 1) 질문 분해 → baseline + 최대 3 변형(generateObject)
const queries = await decompose(userQuestion);   // [원문, 동의어변형, 용어번역, 상위카테고리]
// 2) 병렬 배칭 검색
const hits = (await Promise.all(queries.map(q => hybridRetrieve(q, filters)))).flat();
// 3) entry(slug) 기준 중복 제거 → RRF+degree 리랭크 → 상위 K
return rerank(dedupeBySlug(hits)).slice(0, k);
```

**(b) end-user Q&A 에이전트** — `ToolLoopAgent`로 독립 정의하되, 인입 에이전트의 `AgentTool`로도 노출(재사용·합성):
```ts
export const discoveryAgent = new ToolLoopAgent({
  model: openai(env.AGENT_MODEL),
  instructions: DISCOVERY_SYSTEM_PROMPT,   // B.1 차용(분해→배칭→dedup→rerank)
  tools: { toolHybridRetrieve, toolSearchGraph, toolExecuteSandboxTerminal /* 근거 확인 */ },
  stopWhen: stepCountIs(8),
});
// 합성: 인입 에이전트 tools에 asTool(discoveryAgent) 추가 → 멀티에이전트 1단계 도입
```

적응 프롬프트(요지):
```
너는 WekiFlow 검색 에이전트다. 명확화 질문 없이 먼저 검색한다.
질문을 핵심 엔티티/제약으로 분해하고, 사내 용어로 번역해(예: "연차" → "휴가","월차","근태")
원문 baseline + 최대 3개 변형을 병렬로 hybrid_retrieve 한다.
slug 기준 중복 제거 후 관련성으로 정렬하고, 확신이 안 서면 grep으로 근거를 확인한 뒤
가장 관련 높은 문서 경로만 반환하라.
```

> **가치:** 복합 규정 질문("영업팀 신입 출장 범위?")의 재현율을 분해+멀티쿼리로 끌어올리고, `AgentTool` 합성으로 `docs/22`가 지적한 "멀티에이전트 부재"를 깔끔히 해소. 슬롯: Phase 4 확장([`06` §4]).

---

## C. 두 에이전트의 선순환 결합

```
사용자 질문 ─▶ [Discovery] 분해·검색·답변 ─▶ 실행 궤적(jobs.agentSteps)
                                                      │
                                          [Feedback Learner] 궤적 평가
                                                      │ EnrichmentProposal
                                                      ▼
                                   검토 게이트 ─▶ [Curation C] 문서 보강(가산·비축소)
                                                      │ 번들 커밋 → wkf reindex
                                                      ▼
                                            다음 Discovery가 더 잘 답함 (선순환)
```

→ Discovery(질의) → Learner(격차 탐지) → Curation(보강) → 다시 Discovery. **PRD의 "선순환"을 질의측까지 확장**한 형태.

---

## D. 채용 요약

| 에이전트 | 채용 형태 | 재사용 자산 | 슬롯 | 우선 |
| :--- | :--- | :--- | :--- | :--- |
| Feedback Learner | 파이프라인 D(러너) + WkfEnrichmentProposal + judge 프롬프트 | **`jobs.agentSteps`(이미 존재)** | 7~8 | 상 |
| Discovery | 검색 전처리 분해 + end-user Q&A 에이전트 + AgentTool 합성 | `tool_hybrid_retrieve` | 4 확장 | 중상 |

> 하니스·동기화(produce/evolve/maintain·mdcode) 구현 스펙은 [`09`](./09-enrichment-harness-and-mdcode.md) 참조.
