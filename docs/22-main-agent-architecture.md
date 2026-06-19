# 22. 메인 에이전트 구조 & 모델 매핑 (Main Agent Architecture)

> 메인 인입 파이프라인(Pipeline A)에서 동작하는 에이전트의 실제 구성과,
> 역할/파이프라인별로 사용되는 모델을 정리한다.
> *How the main ingest agent is actually wired, and which model each role/pipeline uses.*

---

## 1. 요약 (TL;DR)

- 메인 에이전트는 **단일 시스템 프롬프트 + 도구 루프(`ToolLoopAgent`)** 구조다.
- 다만 `tool_merge` 내부에 **자체 시스템 프롬프트로 별도 LLM 호출(서브 합성기)** 이 하나 더 있어, 실질적으로 **프롬프트 2단** 구성이다.
- 별도의 멀티 에이전트(역할 분리된 독립 에이전트)는 없다. `tool_merge`의 `generateObject` 호출이 종속된 서브 LLM 역할을 한다.
- 모델은 모두 환경변수로 주입되며 기본값은 `EnvSchema`에 정의되어 있다.

핵심 파일:
- 오케스트레이션: [`workers/main/src/pipeline.ts`](../workers/main/src/pipeline.ts)
- 프롬프트·도구: [`packages/agent-tools/src/index.ts`](../packages/agent-tools/src/index.ts)
- 모델 주입: [`workers/main/src/index.ts`](../workers/main/src/index.ts)
- 모델 기본값: [`packages/shared/src/index.ts`](../packages/shared/src/index.ts) (`EnvSchema`)

---

## 2. 역할/파이프라인별 모델 매핑

모든 모델은 환경변수로 주입되며, 기본값은 `packages/shared/src/index.ts`의 `EnvSchema`(L279–283)에 정의되어 있다.

| 역할 | 환경변수 | 기본 모델 | 제공자 | 사용처 |
|------|----------|-----------|--------|--------|
| **메인 에이전트** (오케스트레이터 루프 + 병합 합성기) | `AGENT_MODEL` | `gpt-5.5` | OpenAI | `workers/main/src/index.ts:29`, `workers/graph/src/index.ts:14` |
| **임베딩** (벡터화) | `EMBEDDING_MODEL` | `text-embedding-3-large` | OpenAI | `workers/main/src/index.ts:31`, `workers/graph/src/index.ts:16` |
| **트리플렛/태그 추출 — 1순위** | `TRIPLET_GOOGLE_MODEL` | `gemini-3.1-flash-lite` | Google | `workers/graph/src/pipeline.ts:45` |
| **트리플렛/태그 추출 — 2순위** | `TRIPLET_ANTHROPIC_MODEL` | `claude-haiku-4-5-20251001` | Anthropic | `workers/graph/src/pipeline.ts:50` |
| **트리플렛/태그 추출 — 폴백** | `TRIPLET_OPENAI_FALLBACK_MODEL` | `gpt-5.4-nano` | OpenAI | `workers/graph/src/pipeline.ts:55` |

### 동작 방식 메모

- **트리플렛 추출 모델**은 `createTripletExtractionModels()`(`workers/graph/src/pipeline.ts:40-59`)에서 **API 키가 설정된 제공자만** 순서대로(Google → Anthropic → OpenAI) 후보 리스트에 추가된다. 즉 폴백 체인 구조다.
- 트리플렛 모델 후보가 하나도 없으면(`tripletModels.length === 0`) `AGENT_MODEL`(기본 `gpt-5.5`)로 대체된다 — `models: tripletModels.length > 0 ? tripletModels : [{ label: 'openai:${AGENT_MODEL}', model }]` (`workers/main/src/index.ts:121`, `workers/graph/src/index.ts:36`).
- 메인 에이전트와 임베딩은 모두 OpenAI provider로 고정 생성된다(`openai(env.AGENT_MODEL)`, `openai.textEmbeddingModel(...)`).

---

## 3. 프롬프트 구성 (2단)

| 구분 | 프롬프트 상수 | 모델 | 역할 |
|------|---------------|------|------|
| 오케스트레이터(루프) | `MAIN_AGENT_SYSTEM_PROMPT` | `AGENT_MODEL` | 추측 금지·grep 검증·도구 호출 순서 결정 |
| 병합 합성기(`tool_merge` 내부) | `MERGE_SYSTEM_PROMPT` | `AGENT_MODEL` | facts → 완성 마크다운 + 변경요약 생성 |

- `MAIN_AGENT_SYSTEM_PROMPT` — `packages/agent-tools/src/index.ts:43-56`
- `MERGE_SYSTEM_PROMPT` — `packages/agent-tools/src/index.ts:58-62`
- 인입 프롬프트(`buildIngestPrompt`) — 제목 + 문서ID + 인입 본문을 담아 `agent.generate({ prompt })`에 전달 (`packages/agent-tools/src/index.ts:64-76`)

---

## 4. 실행 엔진

- Vercel AI SDK `ToolLoopAgent` (`workers/main/src/pipeline.ts:80-85`)
- `stopWhen = stepCountIs(ctx.stepLimit ?? 12)` — 루프 폭주 방지 하드 캡(기본 12스텝)
- `onStepFinish` → SSE 진행률, `recordStep` → `jobs.agentSteps` 감사 로그
- 루프 종료 후 `extractMergeResult(result.steps)`로 **마지막 `tool_merge` 출력**을 추출. 병합 도구가 한 번도 호출되지 않으면 원본을 유지하고 `⚠️ 자동 병합 미완료` 경고 요약을 남긴다.

---

## 5. 도구 6종

| 도구 | 설명 | 비고 |
|------|------|------|
| `tool_search_vector` | 의미 유사 청크 탐색(코사인 유사도) | 앱-코사인 또는 Atlas |
| `tool_search_graph` | 지식그래프 멀티홉 관계 탐색 | `maxDepth` 1–3 |
| `tool_hybrid_retrieve` | 벡터 + 그래프를 RRF로 융합 | `fuseHybridRetrieval` |
| `tool_execute_sandbox_terminal` | Docker 격리 컨테이너에서 bash/python 실행 | 원본 `/docs` read-only 마운트, rg/grep |
| `tool_merge` | facts → 병합 초안 합성 | 내부 `generateObject` + `MERGE_SYSTEM_PROMPT`, `documentId`는 서버측 고정 |
| `tool_verify_integrity` | 핵심 주장(수치/조항)을 `rg -F`로 자가 검증 | 미검증 시 루프가 다시 grep→수정 |

---

## 6. 구성 흐름도

```
┌──────────────────────────────────────────────────────────────────────────┐
│  runIngestJob (BullMQ Job)                          workers/main/src/index │
│   └─ 문서 스냅샷을 임시 디렉터리에 기록 → /docs 로 read-only 마운트        │
└───────────────────────────────┬──────────────────────────────────────────┘
                                 │ runMainPipeline(documentId, ctx)
                                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  ToolLoopAgent  (메인 에이전트 · 단일 시스템 프롬프트)                      │
│  model = AGENT_MODEL (gpt-5.5)                                             │
│  instructions = MAIN_AGENT_SYSTEM_PROMPT  ◀── 프롬프트 ①                  │
│  prompt = buildIngestPrompt(doc)  (제목 + 문서ID + 인입 본문)              │
│  stopWhen = stepCountIs(12)                                               │
│                                                                            │
│   ┌─────────────── 자율 도구 루프 (최대 12스텝) ───────────────┐           │
│   │                                                            │           │
│   │  [탐색·검증]                                               │           │
│   │   • tool_search_vector       의미 유사 청크 (코사인)        │           │
│   │   • tool_search_graph        지식그래프 멀티홉 관계         │           │
│   │   • tool_hybrid_retrieve     벡터+그래프 RRF 융합           │           │
│   │   • tool_execute_sandbox_terminal                          │           │
│   │        └─ Docker 격리 컨테이너에서 rg/grep/python 실행      │           │
│   │           (원본 /docs 에서 수치·조항 직접 확인)             │           │
│   │                                                            │           │
│   │  [병합]                                                    │           │
│   │   • tool_merge(facts) ──────────────┐                      │           │
│   │        │                            ▼                      │           │
│   │        │   ┌─────────────────────────────────────────┐    │           │
│   │        │   │  generateObject (서브 합성기 LLM 호출)   │    │           │
│   │        │   │  model = AGENT_MODEL (gpt-5.5)           │    │           │
│   │        │   │  system = MERGE_SYSTEM_PROMPT ◀ 프롬프트②│    │           │
│   │        │   │  schema = MergeResultSchema              │    │           │
│   │        │   │  → { mergedMarkdown, changeSummary }     │    │           │
│   │        │   └─────────────────────────────────────────┘    │           │
│   │        │   documentId 는 서버측 고정(ctx.documentId)       │           │
│   │                                                            │           │
│   │  [자가검증]                                                │           │
│   │   • tool_verify_integrity(claims)                          │           │
│   │        └─ 각 주장을 rg -F 로 /docs 에서 재확인              │           │
│   │           미검증 시 루프가 다시 grep→수정                   │           │
│   │                                                            │           │
│   └─ onStepFinish → SSE 진행률 / recordStep → jobs.agentSteps ─┘           │
└───────────────────────────────┬──────────────────────────────────────────┘
                                 │ result.steps 에서 마지막 tool_merge 출력 추출
                                 │ (extractMergeResult)
                                 ▼
                ┌───────────────────────────────────────────┐
                │  병합 결과 처리                             │
                │   • preview  → setPreviewDraft  (PREVIEW)  │
                │   • 일반      → setDraft        (REVIEW)   │
                │   • merge 미호출 → 원본 유지 + ⚠️ 경고요약  │
                └───────────────────────────────────────────┘
                                 ▼
                    사람이 Monaco Diff 로 검토 → 승인/반려
```

---

## 7. 관련 문서

- [01. 아키텍처](./01-architecture.md)
- [02. 기술 스택](./02-tech-stack.md)
- [04. 에이전트 도구 명세](./04-agent-tools.md)
- [08. Phase 2 — 샌드박스 파이프라인 A](./08-phase-2-sandbox-pipeline-a.md)
- [09. Phase 3 — 그래프 파이프라인 B](./09-phase-3-graph-pipeline-b.md)
- [10. Phase 4 — 하이브리드 RAG](./10-phase-4-hybrid-rag.md)

## PR-18 update

Discovery now has two entry points: `/api/ask` streams Q&A answers over SSE, and Pipeline A composes the same Discovery `ToolLoopAgent` through `tool_discovery_agent`. This is the first multi-agent composition step; the parent ingest agent and nested Discovery agent keep separate step caps.
