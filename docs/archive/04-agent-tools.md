# 04. 에이전트 도구 명세 (Agent Tools — Vercel AI SDK 6)

> Vercel AI SDK 6의 `tool()` + `Agent`/`ToolLoopAgent` 패턴으로 정의합니다.
> v6에서는 `inputSchema`/`outputSchema`(zod)를 사용합니다(구 `parameters` 아님).
> *Tools are defined with AI SDK 6's `tool()` and consumed by an `Agent`/`ToolLoopAgent` loop.*

---

## 0. 공통 패턴 (Common Pattern)

```ts
// packages/agent-tools/src/index.ts
import { tool } from 'ai';
import { z } from 'zod';

export const toolSearchVector = tool({
  description: '의미론적 유사 청크를 MongoDB Vector Search로 탐색한다.',
  inputSchema: z.object({
    query: z.string().describe('검색 의도(자연어)'),
    k: z.number().int().min(1).max(50).default(8),
    documentId: z.string().optional(),
  }),
  // outputSchema 권장(구조화). execute는 DI된 컨텍스트(db, sandbox 등)를 클로저로 캡처.
  execute: async ({ query, k, documentId }) => { /* ... */ },
});
```

에이전트 조립:

```ts
import { Agent } from 'ai';            // AI SDK 6 Agent 추상화
import { openai } from '@ai-sdk/openai';

export const mainAgent = new Agent({
  model: openai(process.env.AGENT_MODEL!),
  system: MAIN_AGENT_SYSTEM_PROMPT,
  tools: { toolSearchVector, toolSearchGraph, toolExecuteSandboxTerminal, toolMerge, toolVerifyIntegrity },
  stopWhen: stepCountIs(12),           // 루프 폭주 방지
});
```

> ⚠️ 도구 `execute`는 순수 함수가 아니다. DB 핸들·dockerode 클라이언트·현재 jobId를 **팩토리 함수로 주입**(`createTools(ctx)`)하여 워커별 컨텍스트를 분리한다.

---

## 1. `tool_execute_sandbox_terminal` 🌟 (클라우드 쉘/코딩 도구)

**역할:** 격리 Docker 컨테이너에서 `bash`/`python`을 실행하고 `stdout`/`stderr`/`exitCode`를 반환. AI 할루시네이션 원천 차단(Goose-스타일 능동 탐색).

```ts
inputSchema: z.object({
  language: z.enum(['bash', 'python']).default('bash'),
  code: z.string().describe('실행할 명령 또는 스크립트. 예) rg -n "제4조 2항" /docs'),
  timeoutMs: z.number().int().max(30_000).default(10_000),
})
outputSchema: z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
  truncated: z.boolean(),     // 출력 길이 제한 초과 여부
})
```

**구현 핵심:**
- dockerode로 **일회성 컨테이너** 생성 → MinIO 동기화된 문서 디렉터리를 **read-only 마운트**(`/docs`) → exec → 결과 캡처 → 컨테이너 즉시 제거.
- 네트워크 차단(`--network=none`), 읽기전용 루트(`--read-only`), 메모리/CPU/PID 제한, non-root 사용자.
- 출력은 길이 제한(예: 64KB) 후 `truncated=true` 표시.
- 모든 실행은 `sandbox_runs`에 감사 로깅.

보안·구현 상세 → [`05-sandbox-security.md`](./05-sandbox-security.md).

---

## 2. `tool_search_vector` (의미론적 검색)

**역할:** "연차 휴가" 같은 의미 유사 청크 탐색.

```ts
inputSchema: z.object({
  query: z.string(),
  k: z.number().int().min(1).max(50).default(8),
  documentId: z.string().optional(),    // 특정 문서 내로 한정 시
})
```

**구현 (`$vectorSearch`):**

```ts
const queryEmbedding = await embed(query);   // @ai-sdk/openai embed
const results = await db.collection('chunks').aggregate([
  { $vectorSearch: {
      index: 'vector_index',
      path: 'embedding',
      queryVector: queryEmbedding,
      numCandidates: Math.max(100, k * 10),
      limit: k,
      ...(documentId ? { filter: { documentId: new ObjectId(documentId) } } : {}),
  }},
  { $project: { text: 1, documentId: 1, headingPath: 1, score: { $meta: 'vectorSearchScore' } } },
]).toArray();
```

> 반환: `[{ text, documentId, headingPath, score }]`. 점수가 임계 이하면 에이전트가 샌드박스 grep으로 보강하도록 system prompt에 가이드.

---

## 3. `tool_search_graph` (지식 그래프 탐색기)

**역할:** "영업팀 신입사원의 출장 범위?"처럼 여러 규정이 얽힌 질문을 트리플 관계선으로 멀티홉 추론.

```ts
inputSchema: z.object({
  startEntity: z.string().describe('탐색 시작 엔티티(자연어 표면형)'),
  maxDepth: z.number().int().min(1).max(3).default(2),
  predicates: z.array(z.string()).optional(),   // 특정 관계만 따라가기(선택)
})
outputSchema: z.object({
  paths: z.array(z.object({
    nodes: z.array(z.string()),
    edges: z.array(z.object({ subject: z.string(), predicate: z.string(), object: z.string(), strength: z.number() })),
  })),
})
```

**구현:** `startEntity`를 `normalizedName`으로 정규화 → `kg_nodes`에서 노드 찾기 → `$graphLookup`(또는 반복 조회)로 maxDepth까지 확장 → 경로를 사람이 읽을 자연어 트리플로 직렬화하여 반환. ([`03-data-model.md` §4.3](./03-data-model.md))

> Phase 4에서 활성화. Phase 1~3에서는 빈 그래프여도 안전하게 빈 결과 반환.

---

## 4. `tool_extract_triplets` (트리플 추출기 — 파이프라인 B 전용)

**역할:** 배포된 MD 문서를 (Subject)-[Predicate]->(Object) JSON 배열로 변환. LightRAG 방법론.

```ts
inputSchema: z.object({
  documentId: z.string(),
  markdown: z.string(),
})
outputSchema: z.object({
  triplets: z.array(z.object({
    subject: z.string(),
    predicate: z.string(),
    object: z.string(),
    subjectType: z.string(),
    objectType: z.string(),
    strength: z.number().min(0).max(1),
  })),
})
```

**구현:** 청크 단위로 분할 → 각 청크에 LightRAG 추출 시스템 프롬프트(아래)를 `generateObject`로 실행 → 결과를 합쳐 Entity/Relation Resolution 후 `kg_nodes`/`kg_edges` upsert.

### LightRAG 추출 시스템 프롬프트 (요지)

```
너는 지식 추출기다. 주어진 문서를 분석하여
(Subject)-[Predicate]->(Object) 쌍의 JSON 배열로 추출하라.
규칙:
1) 모호한 대명사(그, 이것, 해당 부서 등)는 문맥을 파악해 원본 명사로 치환하라.
2) 각 관계에 0~1 사이 strength(중요도)를 부여하라.
3) 엔티티에 type(PERSON/DEPT/REGULATION/POLICY/ENTITY...)을 부여하라.
4) 사실에 근거한 관계만 추출하고, 추론·창작을 금지한다.
예시:
- (신입사원)-[부여받는다]->(연차 15일), strength 0.9
- (연차 규정)-[결재 권한자]->(부서장), strength 0.95
```

> 검증 PoC는 [`11-testing-and-verification.md` §B](./11-testing-and-verification.md).

---

## 5. `tool_merge` (문서 병합)

**역할:** 수집된 팩트(벡터/그래프/샌드박스 결과)를 근거로 기존 문서에 신규 정보를 병합한 **초안(`draftMarkdown`)** 생성.

```ts
inputSchema: z.object({
  documentId: z.string(),
  facts: z.array(z.object({ source: z.string(), content: z.string() })),
  instruction: z.string().optional(),
})
outputSchema: z.object({
  mergedMarkdown: z.string(),
  changeSummary: z.string(),   // Diff 검토용 요약
})
```

**구현:** 기존 `contentMarkdown` + facts를 LLM에 제공해 병합. 결과를 `documents.draftMarkdown`에 저장하고 status=REVIEW로 전환. `changeSummary`는 Monaco Diff 화면 상단에 표시.

---

## 6. `tool_verify_integrity` (무결성 자가 검증)

**역할:** 병합 초안의 인용 근거·수치·규정번호가 원본과 일치하는지 자가 검증. 불일치 시 에이전트가 다시 샌드박스 grep으로 재확인하도록 유도.

```ts
inputSchema: z.object({
  documentId: z.string(),
  draftMarkdown: z.string(),
  claims: z.array(z.string()).describe('검증할 핵심 주장/수치/조항'),
})
outputSchema: z.object({
  results: z.array(z.object({
    claim: z.string(),
    verified: z.boolean(),
    evidence: z.string(),     // grep 등으로 찾은 근거 라인
  })),
  allVerified: z.boolean(),
})
```

**구현:** 각 claim에 대해 `tool_execute_sandbox_terminal`로 원본에서 `rg`/`grep` 근거 라인 확인. 하나라도 미검증이면 `allVerified=false` → 에이전트 루프가 보강 단계로 회귀. 이 도구가 **할루시네이션 방지의 마지막 게이트**.

---

## 7. 도구 ↔ 파이프라인 매핑 (Tool-to-Pipeline Map)

| 도구 | 파이프라인 A (Main) | 파이프라인 B (Graph) |
| :--- | :---: | :---: |
| `tool_search_vector` | ✅ | — |
| `tool_search_graph` | ✅ (Phase 4) | — |
| `tool_execute_sandbox_terminal` | ✅ | (선택) |
| `tool_merge` | ✅ | — |
| `tool_verify_integrity` | ✅ | — |
| `tool_extract_triplets` | — | ✅ |

> 두 파이프라인은 **별도 Agent 인스턴스**로 정의하여 도구 노출 범위를 분리한다(최소 권한 원칙).
