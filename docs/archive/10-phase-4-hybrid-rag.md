# Phase 4 — 궁극의 하이브리드 RAG 통합 완성

> PRD 🚩 Phase 4: *구축된 지식 그래프를 파이프라인 A의 탐색 도구(`tool_search_graph`)로 연결, 시스템 전면 통합.*
> *Wire the knowledge graph back into Pipeline A's `tool_search_graph` to close the loop.*

목표: 파이프라인 B가 쌓은 지식망을 파이프라인 A가 **멀티홉 추론**으로 활용해, 단순 키워드/벡터를 넘어선 "다차원 관계망 쿼리"를 완성한다. (선순환 완성)

---

## 1. `tool_search_graph` 활성화

Phase 2에서 스텁이던 도구를 실제 구현으로 교체.

```ts
// packages/agent-tools/src/toolSearchGraph.ts
execute: async ({ startEntity, maxDepth, predicates }) => {
  const norm = normalizeEntityName(startEntity);
  const start = await db.collection('kg_nodes').findOne({ normalizedName: norm });
  if (!start) return { paths: [] };               // 빈 그래프 안전 처리

  const paths = await traverseGraph(db, start._id, maxDepth, predicates);  // §2
  return { paths: serializePaths(paths) };        // 자연어 트리플로 직렬화
}
```

> 엔티티 매칭이 정확명으로 안 잡힐 때를 대비해 **임베딩 유사도 fallback**(가장 가까운 노드 top-k)을 둔다.

---

## 2. 멀티홉 그래프 순회 (Multi-hop Traversal)

[`03-data-model.md` §4.3](./03-data-model.md)의 `$graphLookup` 기반. `kg_edges`는 노드→노드 체이닝이므로 다음 둘 중 택1:

**옵션 1 — 반복 BFS(권장, 제어 쉬움):**
```
depth=0: start 노드
각 depth: 현재 노드 집합의 _id가 subjectId인 kg_edges 조회 → objectId 노드 확장
maxDepth(2~3)까지, 방문 노드 set으로 사이클 차단, 노드 수 상한으로 폭주 방지
경로별 edges/nodes 누적 → strength 합/평균으로 랭킹
```

**옵션 2 — `$graphLookup`:** 엣지를 노드 그래프로 보고 `connectFromField: objectId`, `connectToField: subjectId`로 확장. 단일 쿼리지만 경로 재구성이 번거로움.

> PoC는 **옵션 1**. maxDepth 2, 노드 상한 200 권장.

---

## 3. 시스템 통합 (Full Integration)

### 🛠️ 3.1 에이전트 전략 업데이트

메인 시스템 프롬프트에 그래프 우선 사용 가이드 추가:
```
관계가 얽힌 질의(예: "영업팀 신입의 출장 범위")는 먼저 tool_search_graph로
다중 홉 관계를 가져오고, 부족하면 tool_search_vector로 의미 보강,
수치/조항 확정은 tool_execute_sandbox_terminal(grep)로 마무리하라.
```

### 🛠️ 3.2 하이브리드 랭킹 (Hybrid Retrieval Fusion)

벡터 결과 + 그래프 경로 결과를 융합:
- 벡터: 코사인 점수.
- 그래프: 경로 strength 누적 + 홉 거리 패널티.
- 간단한 정규화 후 가중합(RRF, Reciprocal Rank Fusion 권장)으로 상위 컨텍스트 선별.

### 🛠️ 3.3 선순환 확인 (Virtuous Cycle E2E)

```
문서1 승인 → 파이프라인 B가 그래프 노드 적재
        → 새 정보 인입(문서2) → 파이프라인 A가 tool_search_graph로 문서1 지식 활용
        → 더 정확한 병합 → 승인 → 그래프 더 풍부해짐 → 반복
```

---

## 4. 관측성 & 운영 (Observability & Ops)

- 🛠️ 도구별 호출 빈도/지연/실패율 메트릭(pino 로그 + 집계).
- 🛠️ 그래프 통계 대시보드: 노드/엣지 수, 평균 degree, 고립 노드.
- 🛠️ 에이전트 스텝 트레이스 뷰(프론트): `jobs.agentSteps` 타임라인.
- 🛠️ 비용 관측: LLM/임베딩 토큰 사용량 잡 단위 기록.

---

## 5. 강화/확장 백로그 (Post-MVP Backlog)

| 항목 | 설명 |
| :--- | :--- |
| Entity Resolution 고도화 | 임베딩 기반 동의어 병합, 한국어 표기 정규화 사전 |
| 그래프 reconcile job | 문서 수정 시 사라진 관계 정리(현재 append-only) |
| Vector 인덱스 운영 | Atlas Vector Search 튜닝(numCandidates, 필터) |
| 권한 세분화 | 폴더/문서 단위 ACL |
| 샌드박스 강화 | rootless Docker / gVisor / Kata, warm pool |
| 평가(Eval) | RAGAS 등으로 검색·병합 품질 정량 측정 |

---

## 6. ✅ 완료 기준 (Definition of Done)

- [x] `tool_search_graph`가 실제 그래프를 멀티홉 순회(사이클/폭주 방지).
- [x] 관계형 질의에서 그래프 경로가 병합 컨텍스트로 실제 활용됨.
- [x] 벡터+그래프 하이브리드 랭킹(RRF 등) 적용.
- [ ] 선순환 E2E(문서1→그래프→문서2 병합 품질 향상) 시연.
- [ ] 관측성 메트릭/트레이스/비용 로깅 가동.
- [x] 전체 시스템 통합 회귀 테스트 통과.

> 이 게이트를 통과하면 PRD v4.0의 4단계 로드맵이 완성된다.
