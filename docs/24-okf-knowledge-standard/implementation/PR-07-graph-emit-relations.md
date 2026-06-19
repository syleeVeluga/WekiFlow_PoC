# PR-07 — `workers/graph` 재배선: 트리플 → `# Relations` 섹션

> Phase 5 · 선행: PR-06 · 근거: [`04` §4.1](../04-wekiflow-knowledge-spec.md), [`03` §2.5](../03-proposal.md)

## 목표
파이프라인 B(그래프 워커)가 트리플을 **DB에 직접 쓰는 대신** 개념 문서의 `# Relations` 섹션에 기록하도록 재배선한다. 그래프의 SoT가 번들이 되고, `kg_*`는 PR-06 `reindex`가 만든다.

## 범위
- **In:** `tool_extract_triplets` 출력 경로 변경(→ `serializeRelations`로 `# Relations` 갱신 → push), 트리거를 "번들 커밋"으로.
- **Out:** reindex 자체(PR-06), 큐레이션(PR-11).

## 변경 파일
- 🔧 `workers/graph/src/pipeline.ts`(추출 후 DB upsert 제거 → 섹션 기록)
- 🔧 `workers/graph/src/index.ts`(트리거/큐 연결)
- 🔧 `packages/agent-tools`(트리플→Relations 직렬화 재사용, PR-02 `serializeRelations`)

## 구현 단계
1. 추출 결과(triplets)를 `serializeRelations`로 변환해 대상 개념의 `# Relations` 섹션을 **가산적 병합**(기존 트리플 보존, 신규 추가; 중복은 strength max).
2. 변경된 문서를 `wkf push`(PR-05) 경로로 반영 → 이어서 `reindex --concept`(PR-06)로 `kg_*` 갱신.
3. 기존 `kg_nodes`/`kg_edges` **직접 쓰기 코드 제거**(이제 reindex만이 kg_* 작성자).
4. 트리거: 문서 PUBLISHED(=번들 커밋) 시 Graph Queue enqueue 유지.

## 테스트
- 추출 후 `# Relations` 섹션이 정확히 갱신(가산·중복 병합).
- reindex 경유로만 `kg_*`가 변함(워커가 직접 안 씀) — 회귀 테스트.
- 라운드트립: 갱신된 문서가 여전히 `validate` 통과.

## DoD
- [x] 그래프 워커가 `# Relations`만 갱신하고 `kg_*` 직접쓰기를 안 한다.
- [x] 추출→섹션→push→reindex 흐름이 동작.
- [x] 기존 그래프 PoC 테스트가 새 경로로 green.

완료 증거:
- 구현 PR: <https://github.com/syleeVeluga/WekiFlow_PoC/pull/14>
- 검증: `corepack pnpm -r build`, `corepack pnpm -r typecheck`, `corepack pnpm -r test`

## 리스크·메모
- 기존 데이터: 한 번 `wkf pull`+추출로 `# Relations`를 backfill 후 직접쓰기 제거.
- 가산 병합이 비축소 가드레일(PR-03)과 충돌하지 않도록 `# Relations`도 비감소 유지.
