# Phase 3 — Triple 트리플 추출 파이프라인 (파이프라인 B 코어)

> PRD 🚩 Phase 3: *문서 배포(Commit) 이벤트 시 동작하는 백그라운드 Graph 워커. LightRAG 시스템 프롬프트로 Entity/Relationship을 JSON 배열로 추출해 Graph DB에 일관되게 적재.*
> *Background graph worker that extracts triplets (LightRAG) and upserts them into MongoDB.*

목표: 문서가 ✅승인(PUBLISHED)되면 Graph Worker가 가동되어 (Subject)-[Predicate]->(Object) 트리플을 추출하고 `kg_nodes`/`kg_edges`에 정규화 적재한다.

---

## 1. 트리거 (Trigger)

Phase 1에서 이미 `approve` → `graphQueue.add('EXTRACT_TRIPLETS', { documentId })`로 enqueue됨. Phase 3에서 **소비자(Graph Worker)** 를 구현한다.

```ts
new Worker('graph', async (job) => runGraphPipeline(job.data.documentId, ctx),
  { concurrency: 2, prefix: 'wf:graph' });
```

---

## 2. 트리플 추출 (LightRAG 방법론)

LightRAG의 핵심: 문서를 청킹 → LLM으로 엔티티+관계 추출 → **strength score** 부여 → 중복 병합으로 그래프 크기 최소화. (EMNLP 2025)

### 🛠️ 2.1 추출 단계

```ts
// workers/graph/src/runGraphPipeline.ts
export async function runGraphPipeline(documentId: string, ctx) {
  const doc = await documentsRepo.get(documentId);
  const chunks = chunkMarkdown(doc.contentMarkdown);          // heading+토큰 기반

  const all: Triplet[] = [];
  for (const chunk of chunks) {
    const { object } = await generateObject({
      model: openai(process.env.AGENT_MODEL!),
      schema: TripletArraySchema,                             // 04 문서 outputSchema
      system: LIGHTRAG_EXTRACT_PROMPT,                        // §2.2
      prompt: chunk.text,
    });
    all.push(...object.triplets);
  }

  await resolveAndUpsert(all, documentId, ctx.db);            // §3
  await documentsRepo.markGraphIndexed(documentId);           // status=GRAPH_INDEXED
}
```

> `tool_extract_triplets`를 도구로 노출할 수도 있으나, 파이프라인 B는 **결정론적 배치 처리**가 더 안정적이므로 `generateObject` 직접 호출을 권장(에이전트 루프 불필요).

### 🛠️ 2.2 LightRAG 추출 프롬프트

```
너는 지식 추출기다. 문서를 분석하여 (Subject)-[Predicate]->(Object) 트리플의 JSON 배열로 추출하라.
규칙:
1) 모호한 대명사(그, 이것, 해당 부서)는 문맥을 파악해 원본 명사로 치환하라(coreference).
2) 각 트리플에 strength(0~1, 관계 중요도)를 부여하라.
3) 엔티티 type을 지정하라: PERSON | DEPT | REGULATION | POLICY | ENTITY | DATE | AMOUNT ...
4) 문서에 명시된 사실만 추출하라. 추론/창작 금지.
출력 예:
[
  { "subject": "신입사원", "predicate": "부여받는다", "object": "연차 15일",
    "subjectType": "PERSON", "objectType": "REGULATION", "strength": 0.9 },
  { "subject": "연차 규정", "predicate": "결재 권한자", "object": "부서장",
    "subjectType": "POLICY", "objectType": "PERSON", "strength": 0.95 }
]
```

---

## 3. Entity/Relation Resolution & 적재 (`kg_nodes`/`kg_edges`)

[`03-data-model.md` §4](./03-data-model.md)의 규칙을 코드로:

```ts
async function resolveAndUpsert(triplets, documentId, db) {
  for (const t of triplets) {
    const subj = await upsertNode(db, t.subject, t.subjectType, documentId);  // normalizedName 기준 upsert
    const obj  = await upsertNode(db, t.object,  t.objectType,  documentId);
    await upsertEdge(db, {
      subjectId: subj._id, predicate: t.predicate, objectId: obj._id,
      strength: t.strength, sourceDocId: documentId,
    });
  }
}
```

- **`upsertNode`**: `normalizedName`(소문자/공백제거/동의어 정규화)로 `findOneAndUpdate(upsert)`. 기존이면 `aliases`/`descriptions` `$addToSet`, `degree` 증가.
- **`upsertEdge`**: `(subjectId, predicate, objectId)` unique 키로 upsert. 기존이면 `descriptions`/`sourceDocIds` append, `strength`는 `$max`.

> ⚠️ **정규화(normalization) 품질이 그래프 품질을 좌우**. 한국어 동의어/표기 흔들림(예 "부서장"=" 팀장")이 많다면, 정규화 단계에 LLM 기반 엔티티 매칭(임베딩 유사도 + 임계값)을 추가 검토.

---

## 4. 멱등성 & 재실행 (Idempotency)

- 문서 재승인/재처리 시 트리플 중복 방지: upsert 키가 멱등이므로 안전.
- 단, 문서가 **수정**되어 사라진 관계는 그래프에 잔존할 수 있음 → `sourceDocIds`로 추적해 **재인덱싱 시 해당 문서 유래 엣지 갱신/정리** 전략 마련(PoC는 append-only, 프로덕션은 reconcile job).

---

## 5. 검증 (PRD가 강조한 항목 — 코어 PoC B)

[`11-testing-and-verification.md` §B](./11-testing-and-verification.md):
- ✅ 사내 규정 텍스트 입력 시 유효한 `[Entity-Relation-Entity]` JSON 배열을 산출.
- ✅ 동일 엔티티가 서로 다른 청크에서 나와도 하나로 병합(중복 제거).
- ✅ `kg_nodes`/`kg_edges`에 unique 제약 위반 없이 적재.

---

## 6. ✅ 완료 기준 (Definition of Done)

- [x] 문서 승인 → Graph Worker가 자동 가동 → status=GRAPH_INDEXED.
- [x] 추출 트리플이 스키마(zod)에 100% 부합하는 JSON.
- [x] Entity Resolution으로 중복 엔티티가 `normalizedName` 기준 병합.
- [x] 동일 관계 재출현 시 `descriptions`/`sourceDocIds`만 누적, strength `$max`.
- [x] 추출 실패/부분 실패 시 재시도(BullMQ attempts) 및 감사 로깅.
- [x] PoC B(추출 프롬프트) 통과.

> 게이트 통과 후 **Phase 4**(하이브리드 RAG 통합)로.
