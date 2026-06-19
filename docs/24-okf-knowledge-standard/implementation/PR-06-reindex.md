# PR-06 — `wkf reindex` (번들→chunks/벡터 + `# Relations`→kg_*)

> Phase 5 · 선행: PR-02 · 근거: [`04` §4.1](../04-wekiflow-knowledge-spec.md), [`03` §2.2](../03-proposal.md)

## 목표
번들(SoT)에서 MongoDB 파생 인덱스(청크/벡터 + 지식그래프)를 **결정론적·멱등**으로 재빌드한다. "DB 비우고 reindex로 완전복구"가 Phase 5의 핵심 게이트.

## 범위
- **In:** `wkf reindex [--concept <slug>] [--all]`, 청크/임베딩 재생성, `# Relations`→`kg_nodes`/`kg_edges` upsert(Entity Resolution).
- **Out:** index.md 생성(PR-08), graph 워커 재배선(PR-07).

## 변경 파일
- 🆕 `packages/wkf/src/reindex.ts`
- 🔧 `packages/db`(인덱스 보장 재사용), `packages/agent-tools`(임베딩 util 재사용)

## 구현 단계
1. 대상 개념 로드 → `parse`.
2. **청크/벡터:** 본문 청킹 → `embedMany`([`docs/13`]) → `chunks` upsert(documentId 기준 기존 삭제 후 재삽입; `VECTOR_SEARCH_MODE` 무관하게 embedding 저장).
3. **그래프:** `parseRelations(body)` → 정규화(`normalizedName`) → `kg_nodes`/`kg_edges` upsert. 동일 엔티티/관계는 [`03` §4] 병합 규칙(aliases/descriptions append, strength max).
4. 멱등: 동일 번들 재실행 시 DB 상태 동일(해시 비교 테스트).
5. `--all`은 번들 전체, 빈 DB에서도 완전 재구성.

## 테스트
- **완전복구:** 시드 번들 reindex → DB 스냅샷 기록 → DB drop → reindex → 스냅샷 동일.
- 멱등: 2회 reindex 후 `chunks`/`kg_*` 카운트·내용 동일.
- `# Relations` 트리플이 `kg_edges`로 정확 매핑.

## DoD
- [ ] **DB를 비운 뒤 `wkf reindex --all`만으로 벡터·KG 완전 복구**(게이트, [`10` §2.2]).
- [ ] 멱등 보장(2회 실행 동일).
- [ ] Entity Resolution 병합 규칙 준수.

## 리스크·메모
- 임베딩 비용/시간 — `--concept`로 증분 재빌드 지원, 변경분만.
- Atlas 전환 시 `$vectorSearch` 인덱스는 별도(앱-코사인 모드는 임베딩 저장만으로 충분).
