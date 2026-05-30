# Phase 1 — API 엔드포인트 (백엔드)

> PRD 🚩 Phase 1: *Phase 0 컬렉션을 화면이 소비할 REST 라우트로 노출 — 조회 + 검토/멀티소스/지식 변경.*
> *Expose the seeded collections as REST routes the 5+1 screens consume (queries + mutations).*

목표: `apps/web`의 data 훅(Phase 2)이 호출할 엔드포인트를 `apps/api`(Fastify)에 추가한다. 기존 `WekiFlowStore` 인터페이스 + `MongoWekiFlowStore` 패턴을 확장한다.

---

## 1. Store 확장 (`apps/api/src/store.ts` / `mongoStore.ts`)

기존 `WekiFlowStore`(메서드 `tree`/`getDocument`/`createDocument`/`ingest`/`reviews`/`approve`/`reject`/`seed`)에 메서드를 **추가**한다. `InMemoryWekiFlowStore`(테스트용)와 `MongoWekiFlowStore` 양쪽 구현.

```ts
// apps/api/src/store.ts (추가 메서드 시그니처)
export interface WekiFlowStore {
  // …기존…
  listKnowledge(q: KnowledgeQuery): Promise<KnowledgeItem[]>;
  getKnowledge(id: string): Promise<KnowledgeItem | null>;
  patchKnowledge(id: string, body: { contentMarkdown: string }): Promise<KnowledgeItem | null>;
  listTopics(): Promise<Topic[]>;
  createTopic(name: string): Promise<Topic>;
  deleteTopic(id: string): Promise<{ ok: boolean; reassigned: number }>;  // user only
  listAiTagSuggestions(): Promise<AiTagSuggestion[]>;
  resolveAiTagSuggestion(id: string, action: 'approve' | 'reject'): Promise<{ ok: boolean }>;
  listRichReviews(): Promise<ReviewItem[]>;
  resolveReview(id: string, action: 'approve' | 'reject', role: UserRole): Promise<ApproveResult>;
  listMultiSource(): Promise<MultiSourceGroup[]>;
  resolveMultiSource(id: string, body: MsResolveBody, role: UserRole): Promise<ApproveResult>;
  splitMultiSource(id: string): Promise<{ ok: boolean }>;
  requestConfirmMultiSource(id: string): Promise<{ ok: boolean }>;
  homeDigest(): Promise<DailyDigest & { metrics; coverage; mostAsked }>;
  listActivity(limit?: number): Promise<ActivityEntry[]>;
  treeCategories(): Promise<TreeCategory[]>;   // 카테고리→문서 그룹핑
}
```

> ⚠️ 타입은 모두 `@wf/shared`(Phase 0)에서 import. `KnowledgeQuery`(필터/정렬)도 shared에 Zod로 정의해 라우트 검증·store가 공유.

---

## 2. 라우트 명세 (REST)

기존 `server.ts`의 `app.get/post` 패턴 + zod 검증을 따른다. 모든 변경 라우트의 승인 게이트는 **`canApprove(role)`** 재사용(`x-user-role` 헤더, 기존 `approve`와 동일).

### 🛠️ 1.1 조회 (Queries)

| Method | Path | 설명 | 화면 |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/knowledge` | 지식 목록 (쿼리: `person`,`topic`,`tag`,`status`,`q`,`sort=uses\|recent\|alpha`) | 조직 지식 그리드/카테고리 |
| `GET` | `/api/knowledge/:id` | 지식 단건(본문·태그·이력) | 단일 문서 |
| `GET` | `/api/topics` | 주제 분류 목록(system+user) | KB 필터·트리·카테고리 관리 |
| `GET` | `/api/ai-tag-suggestions` | AI 태그 제안(pending) | KB 배너·모달 |
| `GET` | `/api/reviews/rich` | 검토 항목(우선순위·확실성·thread 포함) | 검토 카드/패널 |
| `GET` | `/api/multi-source` | 멀티소스 그룹 | 검토 멀티소스 |
| `GET` | `/api/home/digest` | 다이제스트+상태바 지표+커버리지+가장많이묻는주제 | 홈 |
| `GET` | `/api/activity?limit=5` | 최근 활동 | 홈·(변경 이력 seam) |
| `GET` | `/api/tree/categories` | 카테고리→문서 그룹핑(트리용) | LNB 문서 트리 |

```ts
// 예: GET /api/knowledge — 쿼리 검증 후 store 위임
app.get('/api/knowledge', async (request) => {
  const q = KnowledgeQuerySchema.parse(request.query);   // @wf/shared
  return store.listKnowledge(q);
});
```

### 🛠️ 1.2 변경 (Mutations) — RBAC `canApprove`

| Method | Path | 설명 |
| :--- | :--- | :--- |
| `POST` | `/api/reviews/:id/approve` | 검토 항목 승인 → 대상 문서 반영, `resolved=true` |
| `POST` | `/api/reviews/:id/reject` | 반려 → `resolved=true` |
| `POST` | `/api/multi-source/:id/resolve` | 본문(`targets[]`,`selectedVer`) → 선택 문서들에 반영 |
| `POST` | `/api/multi-source/:id/split` | 개별 검토 항목으로 분리 |
| `POST` | `/api/multi-source/:id/request-confirm` | 담당자 확인 요청(타입 C) |
| `PATCH` | `/api/knowledge/:id` | textarea 편집 저장 → `contentMarkdown` 갱신 + `version`/`modCount` bump |
| `POST` | `/api/topics` | 사용자 주제 추가 |
| `DELETE` | `/api/topics/:id` | 사용자 주제 삭제(system 불가) → 해당 문서 `미분류` 재배정 |
| `POST` | `/api/ai-tag-suggestions/:id/approve` | 태그 승인 → 문서 `aiTags`에 push, 제안 제거 |
| `POST` | `/api/ai-tag-suggestions/:id/reject` | 제안 제거 |

```ts
// 예: 검토 승인 — 기존 approve와 동일한 RBAC 패턴
app.post('/api/reviews/:id/approve', async (request, reply) => {
  const { id } = request.params as { id: string };
  const role = UserRoleSchema.catch('VIEWER').parse(request.headers['x-user-role']);
  if (!canApprove(role)) return reply.code(403).send({ error: 'Forbidden' });   // @wf/shared 재사용
  const result = await store.resolveReview(id, 'approve', role);
  if (!result.ok) return reply.code(result.statusCode).send({ error: result.error });
  return result;
});
```

> ⚠️ 멀티소스 타입 C는 `resolve` 호출을 서버에서 거부(409)하고 `split`/`request-confirm`만 허용 — 목업 규칙("AI 자동 해결 불가") 보존.
> ⚠️ `DELETE /api/topics/:id`는 `source==='system'`이면 400. 삭제 시 해당 `topicId` 문서를 `미분류` 토픽으로 일괄 재배정하고 재배정 건수를 반환.

### 🛠️ 1.3 기존 라우트 유지 (Seam)

`/api/tree`·`/api/documents/:id`·`/api/documents`·`/api/ingest`·`/api/reviews`·`/api/documents/:id/approve`·`/reject`·`/api/jobs/:id/stream`(SSE)는 **그대로 유지**한다. 실 n-depth 트리·파이프라인 인입·SSE 진행률은 향후 폴더 렌즈/실 파이프라인 연동의 seam이다.

---

## 3. 집계 — `/api/home/digest`

별도 컬렉션 없이 roll-up 한다.

```ts
// homeDigest(): 원천 데이터 집계
// - pendingReview = review_items.count({resolved:false}) + multi_source_groups.count({resolved:false})
// - mostAsked / coverage = documents 그룹 집계(부서·작성자별 count) + 시드 상수(검색 빈도 등)
// - sections(충돌/신규/업데이트) = review_items에서 changeType별 상위 N + 연결 documentId
```

> ⚠️ 검색 빈도("오늘 43명이 물어봤습니다")·"오늘 분석 347개" 같은 챗봇/인입 텔레메트리는 PoC에 원천이 없으므로 **시드 상수**로 제공하고 응답 스키마에는 포함(향후 실 로그로 교체할 seam).

---

## 4. ✅ 완료 기준 (Definition of Done)

- [ ] `WekiFlowStore` 인터페이스에 신규 메서드 추가 + `InMemory`/`Mongo` 양쪽 구현.
- [ ] §2 조회 9개 + 변경 10개 라우트 등록, 모든 입력 zod 검증.
- [ ] 변경 라우트의 RBAC가 `canApprove`로 게이트(비권한 403). 멀티소스 타입 C `resolve` 거부(409) + `split`/`request-confirm` 동작.
- [ ] `DELETE /api/topics/:id`가 system 거부(400) + user 삭제 시 문서 `미분류` 재배정 건수 반환.
- [ ] `PATCH /api/knowledge/:id` 저장 시 `version`/`modCount` 증가.
- [ ] 시드 DB 대상 HTTP smoke: `/api/knowledge` 88건·필터 적용 시 부분 집합, `/api/reviews/rich`·`/api/multi-source` 개수, 승인 후 `/api/home/digest`의 검토 대기 수 감소.
- [ ] `apps/api` 테스트(`server.test.ts` 패턴)로 핵심 라우트(승인 RBAC, 토픽 삭제 재배정, 멀티소스 C 거부) 검증.
- [ ] `pnpm -r build && pnpm -r typecheck` 통과.

> ✅ 게이트 통과 시 **Phase 2**(프론트 기반)로 진행. 프론트 data 훅은 이 엔드포인트를 `request<T>`로 소비한다.
> ⚠️ 실시간 갱신은 React Query invalidate로 충분 — 이 단계에서 신규 SSE는 추가하지 않는다.
