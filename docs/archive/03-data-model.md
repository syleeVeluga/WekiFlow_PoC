# 03. 데이터 모델 (Data Model — MongoDB)

> 단일 MongoDB 클러스터에 문서·청크(벡터)·지식그래프(트리플 JSON)·잡·사용자를 통합 저장합니다.
> *All entities in one MongoDB cluster: documents, chunks (with vectors), knowledge graph (triplets as JSON), jobs, users.*

---

## 1. 컬렉션 개요 (Collections Overview)

| 컬렉션 | 목적 | 핵심 인덱스 |
| :--- | :--- | :--- |
| `documents` | 문서 본문(MD), 상태, 트리 위치, 버전 | `parentId`, `status`, `slug(unique)` |
| `chunks` | 문서 청크 + 임베딩 벡터 | **Vector Search index** on `embedding`, `documentId` |
| `kg_nodes` | 지식그래프 엔티티(정규화된 노드) | `normalizedName(unique)`, `type` |
| `kg_edges` | 트리플 관계(Subject→Object) | `subjectId`, `objectId`, 복합 unique |
| `jobs` | 파이프라인 잡 메타·감사 로그 | `type`, `status`, `documentId` |
| `users` | 사용자/권한(RBAC) | `email(unique)` |
| `sandbox_runs` | 샌드박스 실행 감사(명령/결과) | `jobId`, `createdAt(TTL?)` |

> 모든 컬렉션은 `createdAt`/`updatedAt`(ISODate) 포함. `_id`는 ObjectId 기본.

---

## 2. `documents`

문서 트리는 **인접 리스트(adjacency list)** 로 무한 뎁스를 표현합니다(PRD §4 "문서 트리").

```jsonc
{
  "_id": "ObjectId",
  "slug": "hr/annual-leave-policy",        // 트리 경로 기반 unique
  "title": "연차 휴가 규정",
  "parentId": "ObjectId|null",             // 폴더 트리(인접 리스트). null=루트
  "isFolder": false,
  "status": "DRAFT | PROCESSING | REVIEW | PUBLISHED | GRAPH_INDEXED | FAILED",
  "contentMarkdown": "## 제4조 ...",        // 현재(승인된) 본문
  "draftMarkdown": "## 제4조(수정안) ...",   // 파이프라인 A 병합 결과(검토 대기)
  "version": 7,
  "sourceRefs": [                          // 병합 근거(출처 추적)
    { "type": "upload|datasource|manual", "ref": "minio://bucket/key", "note": "" }
  ],
  "assets": [ { "key": "minio://.../img1.png", "kind": "image" } ],
  "createdBy": "ObjectId(user)",
  "approvedBy": "ObjectId(user)|null",
  "createdAt": "ISODate",
  "updatedAt": "ISODate"
}
```

**상태 전이**는 [`01-architecture.md` §5](./01-architecture.md) 상태 머신을 따른다. `draftMarkdown`은 Monaco Diff의 `modified`, `contentMarkdown`은 `original`로 매핑한다.

---

## 3. `chunks` (Vector)

```jsonc
{
  "_id": "ObjectId",
  "documentId": "ObjectId",
  "chunkIndex": 12,
  "text": "신입사원은 입사와 동시에 연차 15일을 부여받는다 ...",
  "tokens": 142,
  "embedding": [0.0123, -0.0456, ...],     // 길이 = numDimensions (모델과 일치)
  "embeddingModel": "text-embedding-3-large",
  "headingPath": ["연차 규정", "제4조"],     // 그래프/네비게이션용 메타
  "createdAt": "ISODate"
}
```

### Vector Search 인덱스 정의 (Atlas)

```jsonc
// db.createSearchIndex("chunks", "vector_index", { ... })
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 3072,               // 모델에 맞춰 1536 또는 3072
      "similarity": "cosine"
    },
    { "type": "filter", "path": "documentId" }
  ]
}
```

검색 쿼리(`$vectorSearch`) 예시는 [`04-agent-tools.md` §tool_search_vector](./04-agent-tools.md) 참조.

> ⚠️ `numDimensions`는 임베딩 모델 차원과 **정확히 일치**해야 함. 모델 교체 시 전체 재임베딩 필요.

---

## 4. 지식 그래프 (JSON 트리플 저장) — `kg_nodes` / `kg_edges`

PRD의 (Subject)-[Predicate]->(Object) 트리플을 **노드/엣지 두 컬렉션**으로 정규화 저장합니다. (사용자 확정: MongoDB JSON 저장)

### 4.1 `kg_nodes` (엔티티)

```jsonc
{
  "_id": "ObjectId",
  "name": "연차 15일",                      // 표시명(원문)
  "normalizedName": "연차15일",             // Entity Resolution 키(소문자/공백제거/동의어정규화) — unique
  "type": "REGULATION|PERSON|DEPT|POLICY|ENTITY|...",
  "aliases": ["연차 십오일", "15일 연차"],   // 병합된 표면형
  "descriptions": [                        // 동일 엔티티는 description만 append (LightRAG 전략)
    { "text": "신입사원에게 부여되는 연차", "sourceDocId": "ObjectId" }
  ],
  "degree": 5,                             // 연결 엣지 수(랭킹용)
  "createdAt": "ISODate",
  "updatedAt": "ISODate"
}
```

### 4.2 `kg_edges` (관계 = 트리플)

```jsonc
{
  "_id": "ObjectId",
  "subjectId": "ObjectId(kg_nodes)",       // (Subject)
  "predicate": "부여받는다",                // [Predicate]
  "objectId": "ObjectId(kg_nodes)",        // (Object)
  "strength": 0.9,                         // LightRAG 관계 중요도 점수
  "descriptions": [                        // 동일 (subject,predicate,object)는 append 병합
    { "text": "신입사원은 부여받는다 연차 15일", "sourceDocId": "ObjectId" }
  ],
  "sourceDocIds": ["ObjectId"],            // 어떤 문서에서 유래했는지 역추적
  "createdAt": "ISODate",
  "updatedAt": "ISODate"
}
```

**중복 제거(Entity/Relation Resolution) 규칙 (LightRAG 차용):**
- 엔티티: `normalizedName`을 primary key로 사용. 동일하면 `aliases`·`descriptions`만 누적.
- 관계: `(subjectId, predicate, objectId)` 셋이 동일하면 동일 관계로 보고 `descriptions`/`sourceDocIds`만 append, `strength`는 최대값 또는 가중 평균.

**유니크 인덱스:**
```js
db.kg_nodes.createIndex({ normalizedName: 1 }, { unique: true })
db.kg_edges.createIndex({ subjectId: 1, predicate: 1, objectId: 1 }, { unique: true })
db.kg_edges.createIndex({ subjectId: 1 })
db.kg_edges.createIndex({ objectId: 1 })
```

### 4.3 멀티홉 추론 ($graphLookup)

`tool_search_graph`는 시작 엔티티에서 N홉까지 관계를 따라간다.

```jsonc
// 예: "영업팀 신입사원이 갈 수 있는 출장 범위?" → 시작노드에서 maxDepth 홉 확장
db.kg_nodes.aggregate([
  { "$match": { "normalizedName": "영업팀" } },
  { "$graphLookup": {
      "from": "kg_edges",
      "startWith": "$_id",
      "connectFromField": "objectId",
      "connectToField": "subjectId",
      "as": "paths",
      "maxDepth": 3,
      "depthField": "hop"
  }}
])
```

> ⚠️ `$graphLookup`은 `kg_edges`의 `subjectId↔objectId` 체이닝을 직접 다룰 때 약간의 파이프라인 설계가 필요(엣지→노드 재조인). PoC에서는 maxDepth 2~3으로 제한해 성능·폭주 방지.

---

## 5. `jobs` (잡 메타 & 감사)

```jsonc
{
  "_id": "ObjectId",
  "bullJobId": "string",                   // BullMQ job id
  "queue": "main | graph",
  "type": "INGEST | MERGE | EXTRACT_TRIPLETS",
  "documentId": "ObjectId",
  "status": "queued|active|completed|failed",
  "attempts": 1,
  "agentSteps": [                          // 에이전트 도구 호출 추적(관측성)
    { "tool": "tool_search_vector", "args": {...}, "tookMs": 120 },
    { "tool": "tool_execute_sandbox_terminal", "cmd": "grep -rnw ...", "exitCode": 0 }
  ],
  "error": "string|null",
  "createdAt": "ISODate",
  "finishedAt": "ISODate|null"
}
```

---

## 6. `users` (RBAC)

```jsonc
{
  "_id": "ObjectId",
  "email": "sylee@veluga.io",              // unique
  "name": "SangYeon",
  "role": "ADMIN | REVIEWER | EDITOR | VIEWER",
  "createdAt": "ISODate"
}
```

- **검토·승인(Commit)** 권한은 `ADMIN`/`REVIEWER`만. (Human-in-the-loop 게이트)

---

## 7. `sandbox_runs` (샌드박스 실행 감사)

```jsonc
{
  "_id": "ObjectId",
  "jobId": "ObjectId",
  "image": "wekiflow/sandbox:latest",
  "command": ["bash", "-lc", "rg -n '제4조 2항' /docs"],
  "stdout": "...", "stderr": "...", "exitCode": 0,
  "durationMs": 340,
  "mounts": [ { "source": "minio://docs", "target": "/docs", "ro": true } ],
  "createdAt": "ISODate"                    // 보존정책: TTL 인덱스로 N일 후 자동 삭제 가능
}
```

---

## 8. 인덱스 일괄 생성 스크립트 위치

Phase 0에서 `packages/db/src/ensureIndexes.ts`로 위 인덱스를 멱등(idempotent) 생성한다. Vector Search 인덱스는 Atlas Search Index API(또는 `createSearchIndex`)로 별도 생성. 자세한 부트스트랩은 [`06-phase-0-foundation.md`](./06-phase-0-foundation.md) 참조.
