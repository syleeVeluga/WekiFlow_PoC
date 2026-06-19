# PR-18 — Q&A 에이전트 + `AgentTool` 합성

> Phase 7 · 선행: PR-17 · 근거: [`08` §B.4](../08-agent-implementation-specs.md), [`docs/22`](../../22-main-agent-architecture.md)

## 목표
end-user용 Discovery Q&A 에이전트를 독립 `ToolLoopAgent`로 정의하되, 인입 에이전트의 `AgentTool`로도 노출해 재사용한다(멀티에이전트 1단계 도입).

## 범위
- **In:** `discoveryAgent`(ToolLoopAgent), API Q&A 라우트(SSE), 인입 에이전트에 `asTool(discoveryAgent)` 합성.
- **Out:** UI(후속 apps/web), 외부 enrichment(PR-19).

## 변경 파일
- 🆕 `packages/agent-tools/src/discovery.ts`(`discoveryAgent`, `DISCOVERY_SYSTEM_PROMPT`)
- 🔧 `apps/api`(Q&A 라우트), `workers/main`(인입 에이전트 tools에 합성)

## 구현 단계
1. `discoveryAgent = new ToolLoopAgent({ model, instructions: DISCOVERY_SYSTEM_PROMPT, tools: { toolHybridRetrieve(PR-17 강화본), toolSearchGraph, toolExecuteSandboxTerminal }, stopWhen: stepCountIs(8) })`.
2. 프롬프트([`08` §B.4]): 명확화 질문 없이 먼저 검색, 분해→배칭→dedup→근거 grep→관련 문서 경로 반환.
3. API: `/api/ask`(SSE 스트리밍, 기존 SSE 인프라 재사용).
4. 합성: 인입 에이전트(`workers/main`) tools에 `asTool(discoveryAgent)` 추가 → 인입 중에도 질의측 검색 재사용.

## 테스트
- 독립 실행: 질문 → 관련 문서 경로 반환(`MockLanguageModelV3`).
- 합성: 인입 에이전트가 discovery를 도구로 호출.
- SSE 스트리밍 동작.

## DoD
- [ ] Discovery가 독립 Q&A로, 그리고 인입 에이전트의 `AgentTool`로 동작한다.
- [ ] `docs/22`의 "멀티에이전트 부재"가 1단계 해소된다.

## 리스크·메모
- 합성 시 step 폭주 방지(부모·자식 각각 stopWhen).
- 근거 확인용 grep은 read-only 마운트 재사용.
