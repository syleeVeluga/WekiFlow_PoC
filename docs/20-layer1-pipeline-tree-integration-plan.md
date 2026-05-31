# 20 — 에이전트 산출물을 실제 DOCUMENT TREE/검토 사이클에 반영 계획

## Context (왜 하는가)

WikiFlow의 목표 사이클은 *입력 → AI 에이전트가 트리플/벡터/read로 유사 내용 검색 → 원문 보존하며 페이지 생성·분류·업데이트 → (필요 시) 검토 → 승인 → 트리플 추출* 입니다. 현재 소유자 전용 **에이전트 미리보기**로 점검 중인데, 미리보기는 의도적으로 **휘발성(ephemeral)** 이라 결과가 어디에도 남지 않습니다.

조사 결과 더 근본적인 단절이 드러났습니다. `documents` 컬렉션 위에 **두 개의 평행 레이어**가 있고, 실제 파이프라인과 화면이 서로 다른 레이어를 봅니다:

- **레이어 1 (실제 에이전트 파이프라인, 백엔드 완비·UI 미연결)**
  `createDraft`→PROCESSING→`runMainPipeline(preview:false)`→`setDraft`=REVIEW→approve/`publish`=PUBLISHED→`EXTRACT_TRIPLETS`→그래프 워커→GRAPH_INDEXED.
  API: `/api/tree`(`docs.tree()` parentId+status), `/api/reviews`(status REVIEW), `/api/ingest`, `/api/documents/:id/approve|reject`.
  프론트 `api/client.ts`+`api/hooks.ts`에 `useTree/useReviews/useApprove/useReject/useJobStream`가 **이미 있으나 라이브 UI에서 미사용**. 죽은 컴포넌트 `components/DocumentTree.tsx`(+`lib/buildTree.ts`)가 이 트리를 렌더링.
- **레이어 2 (위키 데모, 라이브 UI가 보는 유일한 레이어)**
  `documents.wiki` 서브객체 + `topics`/`review_items`/`multi_source_groups`. LNB 트리=`useTreeCategories()`→`/api/tree/categories`; 검토=`useReviewBoard()`→`/api/reviews/rich`+`useMultiSource()`; KB=`/api/knowledge`; DocPage=`useKnowledgeItem`→`/api/knowledge/:id`. 시드(법인카드/출장·정산/복리후생, k01~k88)가 여기에 들어감.

따라서 **실제 파이프라인 모듈은 기술적으로 동작하지만, 화면이 레이어 1을 전혀 읽지 않아 트리에도 검토 큐에도 안 보입니다.**

### 확정된 4가지 결정
1. 라이브 DOCUMENT TREE를 **레이어 1(실제 파이프라인, parentId+status)** 로 전환.
2. 에이전트 미리보기에 **"실제 반영"(영구 저장) 모드** 추가.
3. **원문 vs 드래프트 diff 기반 검토** + 승인→트리플. 단 **승인/반려는 기본 비활성화**, 토글로 활성화 시 동작.
4. **위키 데모 시드 전체 제거** (빈 상태 시작).

### 의도한 결과
소유자가 문서를 업로드(실제 반영 ON)하면 → 에이전트가 처리 → 문서가 트리에 PROCESSING→REVIEW로 등장 → 검토 화면에 diff로 표시 → 승인 활성화 후 승인 → 트리플 추출(GRAPH_INDEXED)까지 **전체 사이클이 UI에서 보입니다.**

---

## 핵심 사실 (구현을 좌우)

- `docs.tree()`는 `{preview:{$ne:true}}`만 제외 → `createDraft`로 만든(=preview 필드 없는) commit 문서는 **모든 상태에서 트리에 노출**. 휘발성 미리보기(`createPreviewDraft`, preview:true)는 계속 숨김. **트리 쿼리 수정 불필요.**
- `docs.reviews()`=`{status:'REVIEW',preview:{$ne:true}}` → commit 문서가 REVIEW가 되면 자동 노출.
- `listAgentPreviewJobs`는 `{queue:'main',type:'PREVIEW'}` 필터. commit 잡도 **`type:'PREVIEW'`로 기록** → 기존 "Recent runs"/SSE/diff UI 그대로 재사용. 구분은 `result.committed=true`로.
- 메인 워커는 `job.name==='PREVIEW'`로 분기(`index.ts:148`). BullMQ `queue.add(name,data,opts)`의 `data`에 `commit`을 실어 분기.
- DocPage 실제문서/위키 구분자: **`/^[a-f0-9]{24}$/i.test(selectedDocId)`** (위키 id는 `k01`류 슬러그, 실제 문서 id는 24자리 hex ObjectId).
- API는 **MongoWekiFlowStore**(실 DB+큐)로 구동(`apps/api/src/index.ts`). InMemory는 테스트 전용 → `agentPreview` 시그니처 변경 시 인터페이스+InMemory+Mongo 3곳 동기화.
- ⚠️ 새 commit 잡의 `runGraphPipeline` 호출은 **기존 `runPreviewJob`의 호출(`model` 단수 전달)을 그대로 미러링** — 시그니처 임의 변경 금지.

---

## 구현 (순서대로)

### 1. 공유 스키마 — `packages/shared/src/index.ts`
- `AgentPreviewRequestSchema`: `commit: z.boolean().optional().default(false)` 추가.
- `AgentPreviewResultSchema`: `committed: z.boolean().optional()` 추가(기존 저장 결과 호환).

### 2. API 인터페이스 + 두 스토어
- `apps/api/src/store.ts` 인터페이스 `agentPreview(input:{title;contentMarkdown;commit?:boolean})`.
- InMemory `agentPreview`(store.ts:252): **기본 분기는 그대로 유지**(테스트 `preview-1`/`originalMarkdown:'# Test'` 보존). `commit` true면 REVIEW 문서도 등록하고 결과에 `committed:true`.
- `apps/api/src/mongoStore.ts`:
  - `enqueue`에 `extraData?` 파라미터 추가 → `queue.add(type,{documentId,...extraData},...)`.
  - `agentPreview`: `commit`이면 `docs.createDraft({title,contentMarkdown})`(영구·비preview) + `enqueue('PREVIEW',doc.id,undefined,{commit:true})`(기본 잡옵션) + 라이프사이클 `type:'PREVIEW'`. 아니면 기존 휘발성 경로 유지.

### 3. API 서버 — `apps/api/src/server.ts`
- `readAgentPreviewInput`: 멀티파트 루프에 `commit` 필드(`part.value==='true'`) 파싱, JSON 분기에 `commit:body.commit??false`. 두 경우 모두 반환에 `commit` 포함 → 라우트가 `store.agentPreview(input)`로 그대로 전달.

### 4. 메인 워커 — `workers/main/src/index.ts`
- `MainJob = Job<{documentId:string; commit?:boolean}>`.
- 분기(`:148`): `PREVIEW`이면서 `job.data.commit` → 새 `runCommitPreviewJob`, 아니면 기존 `runPreviewJob`.
- `runCommitPreviewJob`: 기존 `runPreviewJob`을 복제하되 — (a) `runMainPipeline`을 **`preview` 없이** 호출(청크 인덱싱+`setDraft`→REVIEW), (b) `runGraphPipeline(persist:false)`는 **기존 호출 그대로 미러링**(트리플 미리보기만), (c) 결과에 `committed:true`, (d) **`finally`에서 `deletePreviewArtifacts` 호출하지 않음**(실제 REVIEW 드래프트 보존).

### 5. 프론트 트리 (레이어 1로 전환)
- `apps/web/src/components/lnb/DocumentTree.tsx` 재작성: `useTree()` + `buildTree`(`lib/buildTree.ts`)로 중첩, 각 행에 제목+**상태 배지**(PROCESSING/REVIEW/PUBLISHED/GRAPH_INDEXED), 클릭 시 `openDoc(node.id)`. 죽은 `components/DocumentTree.tsx` 레이아웃을 시각 참조로 재사용. `tree-search` 필터 유지.
- `apps/web/src/components/lnb/Lnb.tsx`: 트리 교체. 배지 재배선 — 검토 배지←`useReviews()` 길이, 조직지식 배지←`usePublished()` 길이(또는 제거). 미사용 위키 훅 임포트 정리.

### 6. DocPage 실제 문서 렌더 — `apps/web/src/components/doc/DocPage.tsx`
- `isRealDoc = /^[a-f0-9]{24}$/i.test(selectedDocId??'')`.
- `useDocument`/`useKnowledgeItem` 둘 다 호출하되 각각 `enabled`로 게이트(훅 순서 안정). 실제 문서면 제목+상태 배지+`MonacoDiffPane(original=contentMarkdown, modified=draftMarkdown??contentMarkdown)` **읽기 전용**(위키 save 미연결). 아니면 기존 위키 경로.

### 7. 미리보기 "실제 반영" 토글
- `api/client.ts`: `agentPreviewUpload`에 `commit` 인자(`form.append('commit','true')`). `agentPreviewMessage`는 타입 본문에 `commit` 포함.
- `api/hooks.ts`: `useAgentPreviewUpload` `mutationFn`에 `commit` 전달.
- `components/agent/AgentPreviewPage.tsx`: `useState(false)` "실제 반영" 스위치(기본 OFF)+ON 경고 배지, `submit`에서 두 mutation에 `commit` 전달.

### 8. 검토 섹션 — `apps/web/src/components/review/ReviewPage.tsx`
- 상단에 `Layer1ReviewSection` 추가: `useReviews()`로 카드 렌더(제목+상태+`MonacoDiffPane` original=contentMarkdown/modified=draftMarkdown).
- **승인/반려 기본 비활성화**: 로컬 `useState(false)` "승인 활성화" 토글 + `canApprove`/`canReview` 게이트. Approve→`useApprove().mutate({id})`, Reject→`useReject().mutate(id)`(트리+검토 무효화 내장). 기존 위키 리뷰 보드는 그대로 두면 시드 제거 후 빈 상태로 렌더.

### 9. 시드 제거 + DB 정리 — `scripts/seed-wiki.ts`
- topics/knowledge/review_items/multi_source_groups/ai_tag_suggestions/activity_log 시드(22~93행) 삭제. **사용자 시드(95~108행) 유지.**
- 멱등 정리 추가: `documents.deleteMany({'wiki.id':{$exists:true}})`(실제 문서는 보존), 그리고 `topics`/`review_items`/`multi_source_groups`/`ai_tag_suggestions`/`activity_log`는 `deleteMany({})`. 최종 counts 로그를 users+실제 문서 기준으로 갱신.
- 결과: KB/홈/카테고리는 빈 상태(허용됨). 배지는 5번에서 레이어 1로 재배선.

---

## 리스크 / 엣지케이스
- **트리플 미리보기는 원문에서 추출**: `runGraphPipeline`이 `contentMarkdown`을 청크. commit 문서는 병합본이 `draftMarkdown`에 있고 `contentMarkdown`은 원문 → 미리보기 트리플은 원문 기준(기존 휘발성 미리보기와 동일). **실제 트리플은 승인 시** publish가 draft→content 복사 후 추출하므로 최종 그래프는 정확.
- **시그니처 동기화**: `agentPreview` 변경은 인터페이스+InMemory+Mongo 3곳. server.test.ts는 `commit` 없이 POST → `.default(false)`로 그린 유지.
- **DocPage 읽기 전용**: 실제 문서에 `usePatchKnowledge`(wiki.id 대상) 연결 금지. 승인은 검토 화면에서만.
- **승인 토글은 로컬 UI 상태**(서버 권한 게이트는 별개로 유지).
- **정리 범위**: 위키 문서는 `{'wiki.id':{$exists:true}}`로만 삭제(실제 레이어 1 문서 안전). 나머지 컬렉션은 위키 전용이라 전체 삭제 안전.

---

## 검증 (end-to-end)

사전: Mongo+Redis 기동, API+메인워커+그래프워커+web dev 실행, 모델/API 키 설정(commit은 실제 에이전트 실행).

```
pnpm -r build            # 공유/db/queue .d.ts 먼저 (관례: build → typecheck 순)
pnpm -r typecheck
pnpm -r test             # apps/api server.test.ts 그린 유지
node --import tsx scripts/seed-wiki.ts   # 사용자만 시드 + 위키 정리; users>=6, 위키 컬렉션 비움
```

UI(소유자 로그인):
1. "에이전트 미리보기" — LNB 트리가 레이어 1 노드+상태 배지로 표시.
2. **실제 반영 ON** → 제목+마크다운(또는 .md/.pdf) → Run. SSE 타임라인(search→merge→graph)+diff+트리플 미리보기("committed" 배지).
3. LNB 트리에 새 문서 PROCESSING→**REVIEW** 등장. 클릭 → DocPage가 제목+상태+Monaco diff(content vs draft).
4. "검토" — 레이어 1 diff 카드. 승인/반려 **비활성**.
5. "승인 활성화" ON → 승인 클릭 → `POST /api/documents/:id/approve` 200 → PUBLISHED + `EXTRACT_TRIPLETS` 큐.
6. 그래프 워커가 kg_nodes/kg_edges upsert + `markGraphIndexed` → 트리 새로고침 시 **GRAPH_INDEXED**, 검토 카드 사라짐.

API/DB 교차확인(소유자 토큰):
```
GET /api/tree           # 상태 변화하는 문서, preview:true 없음
GET /api/reviews        # REVIEW 동안 존재, 승인 후 사라짐
GET /api/agent-preview  # commit 런 표시(type PREVIEW, result.committed=true)
GET /api/documents/:id  # REVIEW→PUBLISHED→GRAPH_INDEXED, REVIEW일 때 draftMarkdown 존재
# mongosh: db.kg_edges.countDocuments({ sourceDocIds: ObjectId("<id>") }) > 0
```

---

## 핵심 수정 파일
- `workers/main/src/index.ts` — commit 잡 분기/함수
- `apps/api/src/mongoStore.ts` — `agentPreview` commit 경로, `enqueue` extraData
- `apps/web/src/components/lnb/DocumentTree.tsx` — 레이어 1 트리
- `apps/web/src/components/review/ReviewPage.tsx` — diff 검토 + 승인 토글
- `scripts/seed-wiki.ts` — 위키 시드 제거 + 정리

보조: `packages/shared/src/index.ts`, `apps/api/src/store.ts`, `apps/api/src/server.ts`, `apps/web/src/components/doc/DocPage.tsx`, `apps/web/src/components/agent/AgentPreviewPage.tsx`, `apps/web/src/components/lnb/Lnb.tsx`, `apps/web/src/api/client.ts`, `apps/web/src/api/hooks.ts`
