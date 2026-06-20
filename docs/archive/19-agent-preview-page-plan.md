# 19 — 에이전트 미리보기(샌드박스 파이프라인 시각화) 계획

> 설정 메뉴에 **소유자(OWNER) 전용** 페이지를 추가한다. 소유자가 문서(md·txt·pdf) 또는 메시지를
> 업로드하면, **Codex / Claude Code처럼 에이전트의 처리 과정을 단계별로 시각화**하고
> **중간 트리플 추출 단계까지 포함**하여 최종 결과(병합 초안 + 트리플)를 보여준다.
> 이 페이지는 **샌드박스 미리보기**로, 실행 결과를 조직 지식베이스(KB)에 **쓰지 않는다**.
>
> *An owner-only "watch the agent think" page: upload → main agent (search/grep/merge/verify) →
> triple extraction → result, fully visualized, with zero writes to the org KB.*

---

## 0. 배경 (Context)

PRD 요구: 설정 메뉴에 에이전트 처리 상황을 볼 수 있는 새 페이지(소유자만). 사용자 입력 문서
(md·txt·pdf, 향후 URL·기타 포맷) → 에이전트 동작 과정을 시각적으로 확인, **중간에 별도 처리되는
트리플 추출 포함**, 결과 확인까지.

현재 시스템은 에이전트를 돌리지만 **과정이 보이지 않는다**:

- **메인 파이프라인** ([workers/main](../workers/main/src/pipeline.ts)) — `ToolLoopAgent`가 벡터
  검색·샌드박스 `rg`/grep·병합(merge)·자가검증(verify)을 수행하고, 각 단계를 `recordStep`으로 Mongo
  `jobs.agentSteps[]`에 **이미 영속화**한다.
- **그래프 파이프라인** ([workers/graph](../workers/graph/src/pipeline.ts)) — LightRAG로 지식
  그래프 트리플을 추출해 `kg_nodes`/`kg_edges`에 upsert한다.
- 두 작업은 **별개 잡**이며, 트리플 추출은 **사람이 REVIEW 초안을 승인한 뒤에만** 실행된다.
- 관찰용 **UI가 없고**, **파일 업로드도 없으며**, 기존 SSE(`/api/jobs/:id/stream`)는 숫자 진행률만
  전달한다.

### 확정된 결정 (Locked Decisions)

| 항목 | 결정 | 비고 |
| :--- | :--- | :--- |
| 페이지 동작 | **샌드박스 미리보기** | 메인+트리플을 끝까지 실행·시각화하되 **KB에 쓰지 않음**(트리에 문서 없음, `kg_*` upsert 없음, 청크 잔존 없음) |
| 파일 포맷 v1 | **md + txt + pdf** + **API로 파일 또는 메시지** | 단일 엔드포인트가 multipart 파일과 JSON 메시지 양쪽 수용 |
| 실행 환경 | **실제 워커 스택 필수** | Mongo + Redis + 워커 + OpenAI + Docker 샌드박스. 데모/목 모드 없음 |

---

## 1. 아키텍처 (Architecture)

전체 미리보기를 **메인 큐의 단일 체인 잡**(`type: 'PREVIEW'`)으로 실행하고, **기존 메인 워커**가
처리한다(실제 스택 그대로 사용 → "목 모드 없음" 충족).

```
POST /api/agent-preview (owner)         worker (main queue, job.name === 'PREVIEW')
  pdf/md/txt 파싱 또는 {message}   ┌──►  runMainPipeline(preview:true)   → steps phase:'main'
  → createPreviewDraft (트랜지언트) │      (search / sandbox / merge / verify, setPreviewDraft)
  → enqueue PREVIEW {documentId}   │      runGraphPipeline(persist:false) → steps phase:'graph'
  → { jobId, documentId }          │      (chunk → 트리플 추출 → dedupe, upsert 안 함)
                                   └──►  finally: deletePreviewArtifacts (문서 + 청크 삭제)
                                         return { draftMarkdown, changeSummary, triplets, ... }

GET /api/agent-preview/:jobId/stream?token=…   (owner, SSE)
  jobs.agentSteps(영속 감사 로그)를 ~500ms 폴링 → `step` 이벤트,
  이후 메인 큐 잡 상태로 `completed`/`failed`
```

**근거 (코드로 검증됨):**

- 에이전트 단계는 이미 `jobs.agentSteps[]`에 **무손실로 영속화**된다. 이 append 로그를 폴링하는 것이
  안전하며, **재생(replay)에 쓰는 데이터와 동일**하다. 반면 BullMQ `job.progress`는 단일 값이라
  빠른 중간 단계가 **합쳐지거나 유실**된다 → **기존 `/api/jobs/:id/stream`은 재사용하지 않고**, 감사
  로그를 tail하는 전용 미리보기 SSE를 추가한다.
- 두 파이프라인을 하나의 메인 큐 잡으로 묶으면 기존 메인 `QueueEvents`·워커 배선(모델·임베딩·
  `DockerSandboxRunner`)을 재사용한다 → **새 큐/QueueEvents 불필요**.
- 트랜지언트 문서가 doc-less 방식보다 침습이 적다. 두 파이프라인 모두
  `documents.getById(documentId)`를 호출하고 `tool_merge`는 `ctx.documentId`를 읽는다
  ([packages/agent-tools/src/index.ts:256](../packages/agent-tools/src/index.ts#L256)). `PREVIEW`
  상태 + `preview:true` 플래그 + **보장된 정리**로 격리한다.

---

## 2. 구현 단계 (계층별)

### 2.1 공유 타입 — [packages/shared/src/index.ts](../packages/shared/src/index.ts)
- `jobTypes`(L14)에 `'PREVIEW'`, `documentStatuses`(L3)에 `'PREVIEW'` 추가 — `reviews()`의
  `{status:'REVIEW'}` 필터와도, 웹의 `'PUBLISHED'` 필터와도 겹치지 않는 상태.
- API·웹 공용 Zod 계약 추가: `AgentStepSchema`(`tool, args, result?, tookMs?, phase?: 'main'|'graph',
  createdAt?`), `AgentPreviewResultSchema`(`documentId, draftMarkdown, changeSummary, merged,
  triplets: TripletSchema[], chunkCount, tripletCount`), `AgentPreviewRequestSchema`(`{ message,
  title? }`).

### 2.2 DB 리포 — [packages/db/src/repositories.ts](../packages/db/src/repositories.ts)
`createDocumentsRepo`:
- `createPreviewDraft(input)` → `status:'PREVIEW'`, `preview:true`로 삽입 (`createDraft` L86 미러).
- `setPreviewDraft(id, draftMarkdown)` → `setDraft`(L137)와 같되 상태를 `PREVIEW`로 유지(기존
  `setDraft`는 `REVIEW`를 하드코딩 → 검토 보드로 누수).
- `deletePreviewArtifacts(documentId)` → `documents.deleteOne` + `chunks.deleteMany({documentId})`.
- **누수 차단:** `tree()`(L67)의 `find({})` → `find({ preview: { $ne: true } })`. `reviews()`(L82)에도
  `preview: { $ne: true }` 추가(이중 방어).

`createJobsRepo`:
- `appendAgentStep`(L547)이 `phase`·`tookMs`도 영속화하도록 확장(agent-tools `AgentStep`은 이미
  `tookMs`를 담지만 현재 버려짐).
- 폴링 SSE·재생용 `getAgentSteps(jobId)` 추가.

### 2.3 agent-tools — [packages/agent-tools/src/index.ts](../packages/agent-tools/src/index.ts)
**변경 없음.** `recordStep`은 이미 `tookMs`를 담는다. `phase`는 워커 래퍼에서 부여 → 툴은 순수 유지.

### 2.4 그래프 파이프라인 — [workers/graph/src/pipeline.ts](../workers/graph/src/pipeline.ts)
- `GraphPipelineContext`에 `persist?: boolean`(기본 `true`). `false`면 `upsertTriplets` +
  `markGraphIndexed`(L87, L94) **건너뜀**.
- 실제 트리플 반환: `GraphPipelineResult`에 `triplets: Triplet[]`, `status:'GRAPH_INDEXED'|'PREVIEW'`
  추가(현재 트리플 미반환, L25).
- `pipeline.test.ts:126`의 정확 일치 단언 → `toMatchObject` + `triplets` 검증으로 완화.

### 2.5 메인 파이프라인 — [workers/main/src/pipeline.ts](../workers/main/src/pipeline.ts)
- `MainPipelineContext`에 `preview?: boolean`. L133에서 분기:
  `ctx.preview ? setPreviewDraft : setDraft`, 결과 `status`도 그에 맞게. 청크 인덱싱은 유지(벡터
  툴이 필요) — 청크는 워커가 사후 삭제.

### 2.6 그래프 패키지 exports — [workers/graph/package.json](../workers/graph/package.json)
- `@wf/graph-worker`는 `main: ./dist/index.js`만 노출하며, 이를 import하면 **두 번째 BullMQ Worker가
  기동**된다(최상위 `await getDb()` + `createWorker`). 메인 워커가 파이프라인만 가져오도록 `exports`
  추가:
  ```json
  "exports": { ".": "./dist/index.js", "./pipeline": "./dist/pipeline.js" }
  ```

### 2.7 메인 워커 — [workers/main/src/index.ts](../workers/main/src/index.ts)
- [workers/main/package.json](../workers/main/package.json) deps에 `@wf/graph-worker` 추가 →
  `@wf/graph-worker/pipeline`에서 `runGraphPipeline` import(**패키지 루트 금지**).
- `job.name === 'PREVIEW'` 분기:
  - `runMainPipeline(documentId, { …, preview: true, recordStep: s => jobs.appendAgentStep(jobId, { ...s, phase: 'main' }) })`
  - 이어서 `runGraphPipeline(documentId, { db, model, persist: false, recordStep: s => jobs.appendAgentStep(jobId, { ...s, phase: 'graph' }) })`
  - `finally`: `docs.deletePreviewArtifacts(documentId)`(기존 `rm(snapshotDir)` L69 옆).
  - return `{ ...mainResult, triplets, chunkCount, tripletCount }`.
- 모듈 스코프 `model`/`embed`/`DockerSandboxRunner` 재사용.

### 2.8 API — [apps/api](../apps/api)
- `package.json`: `@fastify/multipart`, **`unpdf`**(순수 ESM pdf.js 래퍼, Node24/pnpm 친화 — CJS
  `pdf-parse` 회피) 추가.
- `store.ts`(인터페이스 + `InMemoryWekiFlowStore`): `agentPreview({title, contentMarkdown})`,
  `getAgentPreview(jobId)`, `listAgentPreviews()` 추가. **InMemory는 결정적 오프라인 스텁**(가짜 단계
  2~3개 + 스텁 결과)으로 `server.test.ts`를 hermetic하게 유지(Mongo/Redis/Docker 불필요).
- `mongoStore.ts`: `agentPreview` = `docs.createPreviewDraft` + `enqueue(mainQueue,'PREVIEW',id)`;
  `getAgentPreview` = `jobs.getAgentSteps` + `mainQueue.getJob(jobId)` 상태/returnvalue.
- `server.ts` 라우트 — **전부 소유자 게이트**(`currentUser` + `canManageOwners`, L62–66 403 패턴):
  - `POST /api/agent-preview` — `@fastify/multipart` 등록; `request.isMultipart()` 분기(파일 →
    md/txt utf8, pdf → `unpdf`) vs JSON `{message,title}`. 제목 기본값 = 파일명 stem 또는
    `'에이전트 미리보기'`. 추출 결과 공백이면 422. 반환 `{ jobId, documentId }`.
  - `GET /api/agent-preview/:jobId/stream` — `reply.hijack()` SSE(L238 형태 재사용). **쿼리 파라미터
    토큰** `?token=` → `store.me(token)` + `canManageOwners`(EventSource는 Authorization 헤더 불가).
    `getAgentSteps`를 마지막 emit 인덱스 기준으로 ~500ms tail → `step`, 이후 잡 상태로
    `completed`/`failed`.
  - `GET /api/agent-preview/:jobId` — 재생(영속 단계 + 결과).
  - `GET /api/agent-preview` — 최근 실행 목록.

### 2.9 웹 — [apps/web](../apps/web)
- `store.ts`: `ActivePage`(L3)에 `'agent'` 추가.
- `App.tsx`: `activePage === 'agent'`일 때 `<AgentPreviewPage />` 렌더.
- [components/lnb/Lnb.tsx](../apps/web/src/components/lnb/Lnb.tsx): 기어 `sb-menu`(L50)에 소유자 전용
  `에이전트 미리보기` 버튼 → `go('agent')`(`canManageOwners` 게이트, 기존 `사용자 관리` 항목과 동일).
- `api/client.ts`: `agentPreviewUpload(file)`는 **전용 fetch**로(공유 `request()`가 L26에서 JSON
  content-type을 강제해 multipart 경계 깨짐); `agentPreviewMessage`; `fetchAgentPreview` /
  `listAgentPreviews`; 스트림 URL용 모듈 `authToken` 노출.
- `api/hooks.ts`: `useAgentRunStream(jobId)` 신규 — `…/stream?token=`로 `EventSource`,
  `steps[]`(인덱스 dedupe)·`phase`·`progress`·`result`·`done`·`failed` 누적. **`useJobStream`(L94)처럼
  숫자로 강제 변환 금지.**
- **신규** [components/agent/AgentPreviewPage.tsx] — 소유자 게이트(UsersPage.tsx:15와 동일):
  - 입력: 드롭존 `accept=".md,.txt,.pdf"` + 메시지 textarea + 선택적 제목.
  - `StepTimeline` — Claude Code 스타일: 단계 그룹(① 검색·검증 → ② 병합 → ③ 트리플 추출),
    단계별 툴 `Badge`, 인자 요약(`rg`/grep 명령, 검색 `query`, `chunkIndex`), 결과 요약 + `tookMs`,
    진행 중 스피너, `.progress-track`/`.progress-bar`.
  - 결과 패널: lazy `MonacoDiffPane`(원문 vs `draftMarkdown`, DocPage.tsx:6처럼 lazy 로드) +
    신규 `TripletTable`(subject —predicate→ object, 타입 `Badge`, `strength`는 기존 `Certainty` 점).
  - 기존 스타일시트에 `.agent-*` 스코프 CSS 추가(관례 준수, 새 파일 X).

---

## 3. 샌드박스 격리 — 누수 차단 (Leak Prevention)

| 표면 | 누수 경로 | 차단 |
| :--- | :--- | :--- |
| LNB 트리 | `tree()` = `find({})` | `find({ preview: { $ne: true } })` |
| 검토 보드(`/api/reviews`) | `setDraft` → `status:'REVIEW'` | 미리보기는 `setPreviewDraft`(상태 `PREVIEW`); `reviews()`에도 `preview` 필터 |
| **`chunks` 벡터 인덱스** | 미리보기 id로 임베딩 저장; `listForSearch()`가 **전체 청크** 반환 → 이후 실제 인입 오염 | 워커 `finally`에서 `chunks.deleteMany({documentId})` — **가장 위험, 필수** |
| `kg_nodes`/`kg_edges` | `upsertTriplets` + `markGraphIndexed` | `persist:false`로 둘 다 skip; 트리플은 반환/SSE로만 전달 |
| `usePublished`(웹) | `PUBLISHED` 필터 | 승인 경로 없음 → 영원히 PUBLISHED 아님 |
| MinIO | — | 메모리 내 파싱; 객체 미저장 |

안전망: 워커가 `finally` 전에 죽는 경우 대비, 부팅 시 잔여 `{ preview: true }` 문서 스윕(옵션).

---

## 4. AI Provider / 사전 조건

`.env`에 `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`가 채워져 있어 실제 스택 실행 가능.
**이 기능은 기존 provider 배선을 재사용**한다: 임베딩(`openai.textEmbeddingModel(env.EMBEDDING_MODEL)`),
에이전트 루프, 트리플 추출 모두 `@ai-sdk/openai` + `env.AGENT_MODEL` → **실제 사용되는 키는
`OPENAI_API_KEY` 하나**. 에이전트/추출을 Claude·Gemini로 바꾸는 것은 별도 provider 설정 변경
(`openai(...)` → `@ai-sdk/anthropic` / `@ai-sdk/google`)이며 **본 작업 범위 밖**. Anthropic/Google
키는 그 전환을 위해 준비된 것.

---

## 5. 검증 (Verification)

**오프라인(hermetic, CI 안전):**
- [apps/api/src/server.test.ts](../apps/api/src/server.test.ts) 확장: 소유자 `POST /api/agent-preview`
  (JSON) → `{jobId,documentId}`; 비소유자 → 403; 잘못된 토큰 스트림 → 403; 소유자 토큰이면 InMemory
  스텁이 `event: step` → `event: completed` 방출(L52 SSE-after-completion 테스트 미러).
- [workers/graph/src/pipeline.test.ts](../workers/graph/src/pipeline.test.ts): `persist:false`면
  `kg_nodes`/`kg_edges` 비고, 상태 불변, 결과에 `triplets` 포함.
- [workers/main/src/pipeline.test.ts](../workers/main/src/pipeline.test.ts): `preview:true` 케이스 →
  상태가 `REVIEW`가 아닌 `PREVIEW` 유지.
- 빌드 후 타입체크: `pnpm -r build` → `pnpm -r typecheck`(워크스페이스 타입이 dist로 해석됨).

**E2E(실제 스택):** `docker compose up` Mongo+Redis+MinIO, 샌드박스 이미지 빌드, `apps/api` +
`workers/main` + `apps/web` 실행. 소유자 로그인 → 설정 → 에이전트 미리보기 → md·pdf 업로드 →
타임라인 스트리밍 확인 → 트리플·diff 렌더 확인. 이후 격리 검증: `db.documents.find({preview:true})`
공백, 잔여 미리보기 `chunks` 없음, `kg_nodes`/`kg_edges` 카운트 불변, 트리·검토 보드에 업로드 미노출.

---

## 6. 구현 중 확정된 결정
1. **재생 보존 정책** — `GET /api/agent-preview`는 최근 실행을 최대 30개 반환한다. InMemory 테스트
   스텁도 동일하게 최근 30개만 노출한다.
2. **추출 상한** — 업로드 파일은 12MB, PDF는 앞 20페이지, 추출 텍스트는 120,000자, 미리보기 트리플
   추출은 최대 24개 청크로 제한한다. 에이전트 루프의 기존 12 step 캡은 그대로 유지한다.
