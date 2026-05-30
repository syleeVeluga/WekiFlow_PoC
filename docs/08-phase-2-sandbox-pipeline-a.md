# Phase 2 — 샌드박스 터미널 통합 (파이프라인 A 코어)

> PRD 🚩 Phase 2 **[가장 중요]**: *Vercel AI SDK에 격리 컨테이너 연동. 에이전트가 `tool_execute_sandbox_terminal`로 grep/awk를 실행해 로컬 문서에서 팩트를 정확히 빼오는지 집중 테스트.*
> *Wire the sandbox terminal into the agent loop and prove deterministic fact-extraction.*

목표: Main Worker가 **실제 Vercel AI SDK 6 에이전트 루프**로 동작하며, 검색·샌드박스·병합·검증 도구를 자율적으로 사용해 REVIEW 초안을 만든다.

---

## 1. 선행: 샌드박스 러너 (`packages/sandbox`)

[`05-sandbox-security.md`](./05-sandbox-security.md)의 설계대로 구현.

- 🛠️ `DockerSandboxRunner implements SandboxRunner` (dockerode@5).
- 🛠️ 컨테이너 생애주기: 생성(하드닝 옵션) → exec → 결과 캡처(타임아웃/출력제한) → 파기.
- 🛠️ MinIO → 잡별 임시 디렉터리 동기화 → `/docs:ro` 마운트.
- 🛠️ 모든 실행 `sandbox_runs` 감사 기록.

✅ 단위 검증: [`11-testing-and-verification.md` §A](./11-testing-and-verification.md)의 grep PoC가 먼저 통과해야 함.

---

## 2. 에이전트 도구 구현 (`packages/agent-tools`)

[`04-agent-tools.md`](./04-agent-tools.md) 명세대로 구현. Phase 2 범위:

| 도구 | 상태 |
| :--- | :--- |
| `tool_execute_sandbox_terminal` | ✅ 구현(핵심) |
| `tool_search_vector` | ✅ 구현 (Phase 0 §3 선택지에 따른 구현체) |
| `tool_merge` | ✅ 구현 |
| `tool_verify_integrity` | ✅ 구현 (내부에서 샌드박스 grep 사용) |
| `tool_search_graph` | ⏸️ 스텁(빈 결과) — Phase 4에서 활성화 |

**팩토리 주입:**
```ts
// packages/agent-tools/src/createMainTools.ts
export function createMainTools(ctx: { db: Db; sandbox: SandboxRunner; jobId: string; embed: EmbedFn }) {
  return { toolSearchVector: ..., toolExecuteSandboxTerminal: ..., toolMerge: ..., toolVerifyIntegrity: ..., toolSearchGraph: ... };
}
```

---

## 3. Main Agent 루프 (`workers/main`)

```ts
// workers/main/src/runMainPipeline.ts
import { Agent, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';

export async function runMainPipeline(documentId: string, ctx) {
  const tools = createMainTools(ctx);
  const agent = new Agent({
    model: openai(process.env.AGENT_MODEL!),
    system: MAIN_AGENT_SYSTEM_PROMPT,        // §4
    tools,
    stopWhen: stepCountIs(12),               // 루프 폭주 방지
  });

  const doc = await documentsRepo.get(documentId);
  const result = await agent.generate({
    prompt: buildIngestPrompt(doc),          // 인입 정보 + 기존 문서 컨텍스트
    onStepFinish: (step) => publishSse(ctx.jobId, step),  // 진행 상황 SSE
  });

  // tool_merge 결과로 draftMarkdown 저장 + status=REVIEW
  await documentsRepo.setDraft(documentId, result /* mergedMarkdown */);
}
```

워커 등록:
```ts
new Worker('main', async (job) => runMainPipeline(job.data.documentId, ctx), { concurrency: 2, prefix: 'wf:main' });
```

---

## 4. 메인 에이전트 시스템 프롬프트 (요지)

```
너는 WekiFlow의 지식 병합 에이전트다. 목표는 인입된 정보를 기존 문서에 정확히 병합하는 것이다.
원칙:
1) 절대 추측하지 마라. 수치·규정번호·고유명사가 불확실하면
   tool_execute_sandbox_terminal로 rg/grep을 실행해 원본에서 직접 확인하라.
2) 의미적 맥락은 tool_search_vector로, 규정 간 관계는 tool_search_graph로 보강하라.
3) 충분한 팩트가 모이면 tool_merge로 병합 초안을 만들어라.
4) 병합 후 반드시 tool_verify_integrity로 핵심 주장(수치/조항)을 자가 검증하라.
   미검증 항목이 있으면 다시 grep으로 확인 후 수정하라.
5) 최종 결과는 사람이 Monaco Diff로 검토할 것이므로 변경 요약(changeSummary)을 남겨라.
도구는 필요할 때만, 최소 횟수로 호출하라.
```

> 이 프롬프트가 "AI가 헷갈리면 스스로 터미널을 열어 팩트체크"하는 Goose-스타일 행동의 핵심 트리거다.

---

## 5. 청크/임베딩 파이프라인 (인입 시)

병합 전, 인입 문서/기존 문서를 청크로 쪼개 임베딩해 `chunks`에 적재(검색 대상 확보).

- 🛠️ 청킹: heading 기반 + 토큰 상한(예 512토큰, overlap 64).
- 🛠️ 임베딩: `@ai-sdk/openai` `embedMany`, 모델은 `EMBEDDING_MODEL` 환경변수.
- 🛠️ `chunks.embedding` 적재 + (Atlas면) Vector index 자동 반영.

---

## 6. 집중 테스트 (PRD가 강조한 항목)

- ✅ 에이전트가 Vector만으로 확신 못 하는 질의에서 **자발적으로 샌드박스 grep을 호출**하는가?
- ✅ `rg -n "제4조 2항" /docs` 결과의 정확한 라인이 병합/검증에 반영되는가?
- ✅ `tool_verify_integrity`가 허위 수치를 잡아내고 루프가 보강 단계로 회귀하는가?
- ✅ 도구 호출 로그가 `jobs.agentSteps` + SSE에 기록되는가?

---

## 7. ✅ 완료 기준 (Definition of Done)

- [ ] 인입 → Main Worker(실제 에이전트) → REVIEW 초안 생성 E2E 동작.
- [ ] 에이전트가 4종 도구(vector/sandbox/merge/verify)를 자율 선택해 호출.
- [ ] 샌드박스가 격리 옵션(네트워크 차단/read-only/리소스 제한) 준수.
- [ ] grep 기반 팩트가 병합 결과에 정확히 반영(할루시네이션 미발생).
- [ ] `tool_verify_integrity` 미검증 시 재확인 루프 작동.
- [ ] 진행 상황 SSE + `jobs.agentSteps` 감사 로깅.
- [ ] 단계 상한(`stopWhen`)·타임아웃으로 폭주/무한루프 방지.

> 게이트 통과 후 **Phase 3**(파이프라인 B, 트리플 추출)로.
