# PR-17 — Discovery 질문분해 + 다중쿼리 + 리랭크

> Phase 7 · 선행: 없음(독립 트랙) · 근거: [`08` §B](../08-agent-implementation-specs.md)

## 목표
복합 질문을 의미 분해해 baseline + 변형 다중쿼리로 검색하고, 중복제거·리랭크해 재현율을 높인다. `tool_hybrid_retrieve` 앞단 강화.

## 범위
- **In:** `decompose(question)`, 병렬 배칭 검색, slug dedup, RRF+degree 리랭크.
- **Out:** end-user 에이전트/합성(PR-18).

## 변경 파일
- 🔧 `packages/agent-tools`(검색 전처리 + `DISCOVERY_DECOMPOSE_PROMPT`)
- 🔧 기존 `tool_hybrid_retrieve` 래핑

## 구현 단계
1. `decompose(question)`(`generateObject`): baseline(원문) + 최대 3 변형(동의어/사내용어 번역/상위카테고리)([`08` §B.1]). 사내 용어 사전 반영(예: 연차↔휴가↔월차).
2. 병렬 `hybridRetrieve(q, filters)` 배칭 → flat.
3. **slug 기준 중복 제거** → RRF 점수 + `kg_nodes.degree` + grep 검증 보너스로 리랭크 → 상위 K.
4. 필터(predicate 대체): status/tags/트리경로(slug prefix).

## 테스트
- 분해가 baseline + 변형 생성(중복 금지).
- dedup·리랭크 정확.
- 복합 질문 픽스처에서 단일쿼리 대비 재현율↑(PR-16 골든셋 연계).

## DoD
- [x] 복합 질문 재현율이 분해+멀티쿼리로 향상된다.
- [x] 결과가 slug 기준 중복 없이 관련도순.

## 리스크·메모
- 변형 과다 생성 → 비용·중복. 최대 3 + baseline 고정.
- 리랭크는 Vertex 대신 자체(RRF+degree) — GCP 비종속.
