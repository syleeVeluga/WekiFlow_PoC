# AGENTS.md

이 파일은 WekiFlow 저장소에서 작업하는 AI 코딩 에이전트를 위한 루트 지침이다. 하위 디렉터리에 더 구체적인 `AGENTS.md`가 생기면 해당 파일이 우선한다.

## Project Guidelines

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```text
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

## 프로젝트 개요

WekiFlow는 Hybrid RAG(Vector + Graph)와 자체 호스팅 Docker 샌드박스를 결합한 엔터프라이즈 지식 형상관리 워크스페이스다.

핵심 구조는 두 파이프라인이다.

- Pipeline A, Main Worker: 지식 인입, 벡터/그래프/샌드박스 검색, 문서 병합, 자가 검증, 사람 검토.
- Pipeline B, Graph Worker: 승인된 문서에서 LightRAG 방식 트리플을 추출해 MongoDB 그래프 컬렉션에 적재.

승인된 문서는 그래프 인덱싱으로 이어지고, 누적된 그래프는 다음 Pipeline A 실행에서 `tool_search_graph`의 근거가 된다.

## 우선 참고 문서

작업 전 관련 문서를 먼저 읽는다.

- 전체 색인과 확정 결정: `docs/00-README.md`
- 아키텍처와 상태 머신: `docs/01-architecture.md`
- 런타임과 패키지 버전: `docs/02-tech-stack.md`
- MongoDB 컬렉션과 인덱스: `docs/03-data-model.md`
- Vercel AI SDK 도구 명세: `docs/04-agent-tools.md`
- Docker 샌드박스 보안: `docs/05-sandbox-security.md`
- Phase별 작업과 완료 기준: `docs/06-phase-0-foundation.md`부터 `docs/10-phase-4-hybrid-rag.md`
- 테스트 게이트와 PoC: `docs/11-testing-and-verification.md`
- 권장 순서, 리스크, 산출물: `docs/12-roadmap-and-milestones.md`

`WekiFlow PRD v4.0.md`는 제품 의도와 상위 요구사항의 원본이다. 구현 세부는 `docs/` 문서를 우선한다.

## 확정 기술 결정

- 런타임: Node.js 24 LTS, pnpm 10, TypeScript 5.9, ESM, `moduleResolution: NodeNext`.
- 프론트엔드: Vite 8, React 19, BlockNote 0.50, Monaco Diff, TanStack Query 5, Zustand 5.
- API: Fastify, Zod, REST + SSE.
- 큐: BullMQ 5, ioredis 5, Redis 7, 큐별 prefix 분리.
- 데이터: MongoDB 단일 클러스터에 `documents`, `chunks`, `kg_nodes`, `kg_edges`, `jobs`, `users`, `sandbox_runs`.
- 벡터 검색: MongoDB Atlas Vector Search가 기본 목표다. 이 PoC의 Phase 0 기본값은 `VECTOR_SEARCH_MODE=app-cosine`이며, 결정 기록은 `docs/13-implementation-decisions.md`를 따른다.
- 그래프: Neo4j를 쓰지 않는다. MongoDB JSON 트리플과 `$graphLookup` 또는 제어 가능한 BFS를 사용한다.
- 샌드박스: E2B를 쓰지 않는다. `dockerode` 기반 자체 격리 Docker 런타임을 사용한다.
- 모델명과 임베딩 모델은 환경변수(`AGENT_MODEL`, `EMBEDDING_MODEL`)로 주입하고 코드에 고정하지 않는다.

## 목표 모노레포 구조

Phase 0의 목표 구조를 따른다.

```text
apps/
  web/       # Vite + React UI
  api/       # Fastify API
workers/
  main/      # Pipeline A
  graph/     # Pipeline B
packages/
  shared/    # 타입, zod 스키마, 상수
  db/        # MongoDB 클라이언트, 인덱스, repo
  queue/     # BullMQ 큐/워커 팩토리
  storage/   # MinIO 래퍼
  sandbox/   # SandboxRunner, DockerSandboxRunner
  agent-tools/ # AI SDK tools와 agent 조립
docker/
  sandbox/Dockerfile
```

## 구현 순서

1. Phase 0: pnpm 모노레포, 로컬 Redis/MongoDB/MinIO, DB 인덱스, 샌드박스 이미지.
2. 코어 PoC 2종: 샌드박스 `rg` 실행 테스트, LightRAG 트리플 추출 테스트.
3. Phase 1: BlockNote와 Monaco Diff 토글 UI, Fastify API, Main Queue 스텁 흐름.
4. Phase 2: 실제 Main Agent 루프, 샌드박스/벡터/병합/검증 도구.
5. Phase 3: Graph Worker, 트리플 추출, Entity/Relation Resolution, MongoDB 적재.
6. Phase 4: `tool_search_graph`, 멀티홉 순회, 벡터+그래프 하이브리드 랭킹, 선순환 E2E.

각 Phase 문서의 완료 기준을 작업 게이트로 사용한다.

## 코딩 규칙

- TypeScript strict 모드를 유지한다.
- 모든 패키지는 ESM 기준으로 작성한다.
- 공통 타입, 상태 enum, zod 스키마는 `packages/shared`에 둔다.
- DB, 큐, 스토리지, 샌드박스 클라이언트는 패키지 경계를 지켜 재사용 가능한 래퍼로 만든다.
- 에이전트 도구는 `createTools(ctx)` 같은 팩토리로 DB 핸들, jobId, sandbox runner, embed 함수 등 실행 컨텍스트를 주입한다.
- Pipeline A와 Pipeline B는 별도 Agent 또는 실행 루프로 유지하고, 각 파이프라인에 필요한 도구만 노출한다.
- 문서 상태 전이는 `DRAFT -> PROCESSING -> REVIEW -> PUBLISHED -> GRAPH_INDEXED` 흐름을 기준으로 한다. 실패는 `FAILED`로 기록한다.
- `draftMarkdown`은 Monaco Diff의 modified, `contentMarkdown`은 original로 사용한다.
- 사용자 승인 권한은 `ADMIN`과 `REVIEWER`로 제한한다.
- 큐 잡과 트리플 적재는 멱등성을 우선한다.

## 샌드박스 보안 규칙

`tool_execute_sandbox_terminal` 구현 시 다음을 기본값으로 둔다.

- 호출 또는 잡마다 일회성 컨테이너를 생성하고 종료 후 제거한다.
- 네트워크는 차단한다: `NetworkMode: none`, `NetworkDisabled: true`.
- 루트 파일시스템은 read-only로 둔다.
- 문서 스냅샷은 `/docs:ro`로만 마운트한다.
- 쓰기 가능 영역은 제한된 tmpfs(`/work`, `/tmp`)만 허용한다.
- 컨테이너는 non-root 사용자로 실행한다.
- `CapDrop: ALL`, `no-new-privileges`, 메모리/CPU/PID/timeout/stdout cap을 적용한다.
- MinIO, DB, LLM API 키 같은 비밀은 컨테이너 env에 넣지 않는다.
- 모든 실행은 `sandbox_runs`와 `jobs.agentSteps`에 감사 로그를 남긴다.

Docker 소켓 접근은 루트급 권한으로 취급한다. 운영 단계에서는 rootless Docker, 전용 격리 호스트, gVisor/Kata 같은 추가 격리를 검토한다.

## 에이전트 동작 원칙

- 수치, 조항 번호, 고유명사, 정책 문구가 불확실하면 추측하지 말고 샌드박스에서 `rg`로 원문을 확인한다.
- 의미 유사 검색은 `tool_search_vector`로 시작하되, 점수가 낮거나 근거가 불명확하면 샌드박스 grep으로 보강한다.
- 관계형 질의는 Phase 4부터 `tool_search_graph`를 우선 고려한다.
- 병합 후에는 `tool_verify_integrity`로 핵심 claim을 검증한다.
- 도구 호출은 필요한 만큼만 수행하고, `stopWhen`, timeout, 출력 제한으로 폭주를 막는다.

## 테스트와 검증

작업 범위에 맞춰 다음 게이트를 사용한다.

- `pnpm -r typecheck`
- `pnpm -r test`
- `pnpm tsx scripts/poc-sandbox-grep.ts`
- `pnpm tsx scripts/poc-lightrag-extract.ts`
- lint/format 체크

Phase별 상세 완료 기준은 각 문서의 Definition of Done을 따른다. LLM 호출 테스트는 구조화 출력과 zod 스키마 검증을 우선하고, 품질 평가는 별도 eval 트랙으로 분리한다.

## 문서 업데이트 규칙

- 확정 결정이 바뀌면 관련 `docs/` 문서와 이 파일을 함께 갱신한다.
- 버전은 설치 직전 `npm view <pkg> version`으로 재확인한다.
- Atlas Vector Search 사용 여부 같은 Phase 0 결정은 이후 구현 문서와 환경변수 예시에 반영한다.
- 새로운 하위 영역에 별도 규칙이 필요하면 해당 디렉터리에 하위 `AGENTS.md`를 추가한다.
