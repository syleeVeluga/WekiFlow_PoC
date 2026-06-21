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

제품 표면의 핵심 흐름은 다음이다.

1. 파일, 대화, 회의록, 위키, Drive 문서를 인입한다.
2. AI가 원본을 읽고 정리해 지식 후보를 만든다.
3. 일반 지식은 자동 게시 가능하지만, 정책·규정·계약·보안·가격·학칙·공식 답변 후보는 사람 승인으로 승격한다.
4. 게시된 지식은 질문 답변, 탐색, 지식 맵, export/MCP에 재사용된다.

내부 구현은 여러 워커/에이전트로 나뉜다.

- Enrichment Draft/Main Worker: 인입된 파일·URL·수동 입력을 요약, 핵심 사실, Q&A, 태그, 링크, 출처가 있는 지식 후보로 만든다.
- Conversation/Learner Worker: 대화·회의록·실패 궤적에서 저장할 만한 후보, 부족한 지식, 검증 필요 신호를 만든다.
- Curation Worker: 이미 게시된 지식을 신선도와 원문 변경 기준으로 재검증하고, 통째 재작성 없이 가산 보강안만 제안한다.
- Graph Worker/Reindex: 승인된 WKF 번들의 `# Relations`와 Markdown 링크를 읽어 검색용 그래프/벡터 인덱스를 재생성한다. `kg_*`는 파생 인덱스이지 진실의 원천이 아니다.
- Discovery Agent: 게시된 지식과 출처 확인 후보를 검색해 답변하고, 부족한 맥락은 새 후보/보강 제안으로 되돌린다.

진실의 원천은 OKF/WKF 호환 Markdown 번들이다. MongoDB의 `documents`, `chunks`, `kg_nodes`, `kg_edges`는 제품 저장소와 검색 성능을 위한 운영 데이터이며, 그래프는 `wkf reindex`로 재생성 가능해야 한다.

## 우선 참고 문서

작업 전 관련 문서를 먼저 읽는다. 문서는 세 버킷으로 정리돼 있다 — 전체 색인은 [`docs/README.md`](docs/README.md).

- **참고(reference)** — 현재 구현된 시스템의 설계·스펙:
  - 메인 에이전트 구조·모델 매핑: `docs/reference/main-agent-architecture.md`
  - OKF 기반 지식표준(WKF) 설계: `docs/reference/okf-knowledge-standard/` (스펙 04 · 큐레이션 05 · 포맷·생성 07 · Learner/Discovery 08 · enrichment·동기화 09)
  - WKF 런타임 스펙: `packages/wkf/SPEC.md`
- **남은 작업(plans)** — `docs/plans/`
  - 워크스페이스 인가 TODO: `docs/plans/workspace-authorization.md`
- **이력(archive)** — 초기 Phase 0–4 아키텍처 설계(`docs/archive/01-architecture.md` 등), 프론트엔드 UI 구현 계획(`docs/archive/frontend-ui/`), 완료된 계획 18–21, OKF 조사·통합실행계획·구현기록(PR-01~20), OKF/enrichment 제품 흐름 재정렬 구현기록(PR-26~35)은 `docs/archive/`에 보존돼 있다. 역사적 기록이며 일부 상호링크가 깨질 수 있다.

`WekiFlow PRD v4.0`은 제품 의도와 상위 요구사항의 원본으로 `docs/archive/WekiFlow-PRD-v4.0.md`에 보관한다. 구현 세부는 위 reference 문서를 우선한다.

## 확정 기술 결정

- 런타임: Node.js 24 LTS, pnpm 10, TypeScript 5.9, ESM, `moduleResolution: NodeNext`.
- 프론트엔드: Vite 8, React 19, BlockNote 0.50, Monaco Diff, TanStack Query 5, Zustand 5.
- API: Fastify, Zod, REST + SSE.
- 큐: BullMQ 5, ioredis 5, Redis 7, 큐별 prefix 분리.
- 데이터: MongoDB 단일 클러스터에 `documents`, `chunks`, `kg_nodes`, `kg_edges`, `jobs`, `users`, `sandbox_runs`.
- 벡터 검색: MongoDB Atlas Vector Search가 기본 목표다. 이 PoC의 Phase 0 기본값은 `VECTOR_SEARCH_MODE=app-cosine`이며, 결정 기록은 `docs/archive/13-implementation-decisions.md`를 따른다.
- 그래프: Neo4j를 쓰지 않는다. MongoDB JSON 트리플과 `$graphLookup` 또는 제어 가능한 BFS를 사용한다.
- 샌드박스: E2B를 쓰지 않는다. `dockerode` 기반 자체 격리 Docker 런타임을 사용한다.
- 모델명, 임베딩 모델, AI provider API key는 환경변수(`AGENT_MODEL`, `EMBEDDING_MODEL`, `OPENAI_API_KEY` 등)로 주입하고 코드에 고정하지 않는다.

## 목표 모노레포 구조

Phase 0의 목표 구조를 따른다.

```text
apps/
  web/       # Vite + React UI
  api/       # Fastify API
workers/
  main/      # Enrichment Draft / 인입 후보 생성
  graph/     # WKF relations emit / derived graph reindex
  curation/  # 게시 지식 재검증·가산 보강
  learner/   # 실행 궤적·대화 기반 지식 격차 제안
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
2. 코어 PoC 2종: 샌드박스 `rg` 실행 테스트, Triple 트리플 추출 테스트.
3. Phase 1: BlockNote와 Monaco Diff 토글 UI, Fastify API, Main Queue 스텁 흐름.
4. Phase 2: 실제 Main Agent 루프, 샌드박스/벡터/병합/검증 도구.
5. Phase 3: Graph Worker, 트리플 추출, Entity/Relation Resolution, MongoDB 적재.
6. Phase 4: `tool_search_graph`, 멀티홉 순회, 벡터+그래프 하이브리드 랭킹, 선순환 E2E.

각 Phase 문서의 완료 기준을 작업 게이트로 사용한다.

OKF/WKF PR-01~20은 구현 완료되어 `docs/archive/okf-knowledge-standard/implementation/`에 보존돼 있다. OKF/enrichment 제품 흐름 재정렬 PR-26~35도 완료되어 `docs/archive/okf-enrichment-product-flow/`에 보존돼 있다. 이후 OKF/enrichment 관련 작업은 현재 구현 기준의 `docs/reference/okf-knowledge-standard/`와 archived PR-26~35 기록을 함께 대조한다.

## 코딩 규칙

- TypeScript strict 모드를 유지한다.
- 모든 패키지는 ESM 기준으로 작성한다.
- 공통 타입, 상태 enum, zod 스키마는 `packages/shared`에 둔다.
- DB, 큐, 스토리지, 샌드박스 클라이언트는 패키지 경계를 지켜 재사용 가능한 래퍼로 만든다.
- 에이전트 도구는 `createTools(ctx)` 같은 팩토리로 DB 핸들, jobId, sandbox runner, embed 함수 등 실행 컨텍스트를 주입한다.
- 에이전트/워커는 역할별 실행 루프로 유지하고, 각 역할에 필요한 도구만 노출한다.
- 문서 상태 전이는 `DRAFT -> PROCESSING -> REVIEW -> PUBLISHED -> GRAPH_INDEXED` 흐름을 기준으로 한다. 실패는 `FAILED`로 기록한다.
- `draftMarkdown`은 Monaco Diff의 modified, `contentMarkdown`은 original로 사용한다.
- 사용자 최종 승인 권한은 실제 role enum 기준 `OWNER`와 `APPROVER`를 기본으로 한다. 정책 문서의 role 값은 `userRoles`와 대조 검증해 enum drift를 조용히 허용하지 않는다.
- 개발자 제어판 접근은 role 사다리와 직교하는 `isSuperAdmin` 플래그로만 판단한다.
- 큐 잡과 트리플 적재는 멱등성을 우선한다.

## OKF/enrichment 제품 원칙

- OKF/WKF는 사용자-facing 개념이 아니라 내부 저장·교환 포맷이다. UI 문구에는 Pipeline A/B/C/D, WKF, `# Relations` 같은 내부 용어를 기본 노출하지 않는다.
- 사용자 흐름은 "넣기 → AI 정리 → 필요한 경우 승인 → 질문/탐색"으로 유지한다.
- 모든 인입 파일·대화·회의록·외부 문서는 우선 원본 또는 지식 후보로 저장한다. 공식 지식으로 승격하려면 출처 확인 또는 승인 정책을 통과해야 한다.
- source-only 원본 문서는 사용자에게 `인입 원본` / `지식화 안 됨`으로 보여야 하며 숨기지 않는다. 승인 비활성화(`reviewApprovalEnabled=false`) 상태에서 사용자가 `AI로 지식화`를 명시적으로 실행하면 `PUBLISHED`로 물질화되어 `AI 정리됨` 태그와 `지식화 완료` 배지를 갖고 홈 다이제스트, 조직 지식, 지식 맵에 반영된다. 승인 활성화 상태에서는 이 경로가 승인 우회가 되어서는 안 된다. 상세 계약은 `docs/reference/source-to-official-knowledge-flow.md`를 따른다.
- Enrichment Draft Agent는 기존 Main/Ingest Agent의 제품명이다. 역할은 기존 문서 병합뿐 아니라 신규 후보 생성, 기존 지식 보강, skip/source-only 판단까지 포함한다.
- Conversation Ingest는 대화 내용을 공식 지식으로 직접 쓰지 않는다. 대화 기반 후보는 `확인 필요`로 두고, 원본 문서 연결 또는 담당자 승인 후 공식화한다.
- Curation은 published 지식에만 강한 가드레일을 적용한다. `assertNoShrinkage` 같은 비축소 검증은 curation-origin 변경과 감사 친화적 거부 경로에 집중하고, 일반 신규 인입에는 과도하게 적용하지 않는다.
- Knowledge Map은 OKF Markdown 링크와 backlinks를 먼저 사용한다. typed `# Relations`와 `kg_*` 멀티홉 그래프는 고급 검색/토글 레이어로 둔다.
- 답변과 지식 카드에는 가능한 한 `AI 정리됨`, `출처 확인됨`, `승인 필요`, `공식 지식`, `확인 필요`, `충돌 있음` 같은 신뢰 상태를 일관되게 표시한다.

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
- 관계형 질의는 Markdown 링크, backlinks, tags, citations, `tool_search_graph`를 함께 고려한다. 사용자-facing 지식 맵은 Markdown 링크 기반 탐색을 우선한다.
- 병합 후에는 `tool_verify_integrity`로 핵심 claim을 검증한다.
- 도구 호출은 필요한 만큼만 수행하고, `stopWhen`, timeout, 출력 제한으로 폭주를 막는다.

## 테스트와 검증

작업 범위에 맞춰 다음 게이트를 사용한다.

- `corepack pnpm build`
- `corepack pnpm -r typecheck`
- `corepack pnpm -r test`
- `pnpm tsx scripts/poc-sandbox-grep.ts`
- `pnpm tsx scripts/poc-lightrag-extract.ts`
- lint/format 체크

문서-only 변경은 `git diff --check` 또는 `git diff --cached --check`를 최소 게이트로 사용한다. Phase별 상세 완료 기준은 각 문서의 Definition of Done을 따른다. LLM 호출 테스트는 구조화 출력과 zod 스키마 검증을 우선하고, 품질 평가는 별도 eval 트랙으로 분리한다.

## 문서 업데이트 규칙

- 확정 결정이 바뀌면 관련 `docs/` 문서와 이 파일을 함께 갱신한다.
- 버전은 설치 직전 `npm view <pkg> version`으로 재확인한다.
- Atlas Vector Search 사용 여부 같은 Phase 0 결정은 이후 구현 문서와 환경변수 예시에 반영한다.
- 새로운 하위 영역에 별도 규칙이 필요하면 해당 디렉터리에 하위 `AGENTS.md`를 추가한다.
