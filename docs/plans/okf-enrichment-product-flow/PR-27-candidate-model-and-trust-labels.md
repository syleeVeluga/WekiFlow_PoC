# PR-27 — KnowledgeCandidate 모델·API + 신뢰 라벨 UI (T1)

> Track T1 · 상태: 완료(PR #39) · 선행: [PR-26](./PR-26-candidate-contract.md) · 근거: [`Overview.md`](./Overview.md) §3.1·§5.1-2·§5.2-5, [`Gap-Analysis.md`](./Gap-Analysis.md) §2.2·§3.5
> 외부 API 메모: 없음.

## 목표

PR-26 contract를 실제 저장 모델·API·UI로 구현한다. 후보를 1급 엔터티로 만들고(현재는 `documents.status`로 대체), 후보 카드와 신뢰 라벨을 사용자-facing으로 일관 표시한다.

## 범위

- **In:**
  - `knowledge_candidates` 저장 모델(또는 `documents`에 candidate 필드 확장) + repository.
  - 후보 CRUD/list API(상태·위험도·provenance 포함).
  - 신뢰 라벨 컴포넌트(`AI 정리됨 / 출처 확인됨 / 공식 지식 / 확인 필요 / 승인 필요 / 충돌 있음`)와 KB·후보 카드 적용.
- **Out:** 인입 시 후보 생성 로직(→ PR-28), 대화 후보(→ PR-30), 위험도 라우팅 UX(→ PR-32), 답변 라벨(→ PR-34).

## 변경 파일

- 🆕 `packages/db/src/candidateRepository.ts` — `createCandidate`, `listCandidates(filter)`, `getCandidate`, `updateCandidateStatus`.
- 🔧 `packages/shared/src/index.ts` — `KnowledgeCandidateSchema`(PR-26 타입 조합), DB 도큐먼트 형태.
- 🔧 `apps/api/src/server.ts` — `GET /api/candidates`, `GET /api/candidates/:id`, `PATCH /api/candidates/:id`(상태 전이).
- 🆕 `apps/web/src/components/common/TrustLabel.tsx` — 상태→배지 매핑(색·아이콘·툴팁).
- 🔧 `apps/web/src/components/kb/KbPage.tsx` — freshness 프록시를 TrustLabel로 교체/병행.
- 🔧 `apps/web/src/components/review/ReviewPage.tsx` — 후보 카드에 TrustLabel + 위험 사유 요약.

## 구현 단계

1. **스키마.** PR-26의 `CandidateStatus/RiskFactor/Provenance`를 합쳐 `KnowledgeCandidate`(id, title, summary, bodyMarkdown, status, riskFactors[], provenance, linkedDocId?, conflictWith[], createdAt). MongoDB 컬렉션 `knowledge_candidates`.
2. **Repository.** 상태·위험도·provenance.kind·workspace 필터 지원 `listCandidates`. `updateCandidateStatus`는 PR-26 전이 규칙을 서버에서 강제.
3. **API.** 목록/상세/상태전이 라우트. 권한은 기존 `canEdit`/역할 체크 재사용. `PATCH`는 허용 전이만 통과.
4. **TrustLabel 컴포넌트.** PR-26 `CANDIDATE_STATUS_LABEL` + 색상 토큰. 위험 후보는 사유 뱃지(예: "정책성", "출처 없음") 노출.
5. **KB/Review 적용.** KB 카드: 발행 지식은 `공식 지식`, 그 외 후보 상태 표시. Review 카드: 상태 + 위험 사유 + certainty.
6. **마이그레이션.** 기존 `documents`(DRAFT/REVIEW) 중 후보 성격 데이터를 후보 컬렉션으로 투영하는 일회성 스크립트(또는 read-through 어댑터). 기존 published는 그대로 유지.

## 테스트

- repository: 필터 조합, 허용/금지 상태전이.
- API: 권한별 접근, 잘못된 전이 거부(400).
- UI: 각 상태 라벨 렌더 스냅샷, 위험 사유 뱃지 표시.
- 마이그레이션: 샘플 documents → candidates 투영 정확성, published 무손상.

## DoD

- [x] `knowledge_candidates`가 1급 모델로 존재하고 상태/위험도/provenance를 보존한다.
- [x] 후보 목록·상세·상태전이 API가 동작하고 전이 규칙을 강제한다.
- [x] KB·Review 화면에 6종 신뢰 라벨이 일관 표시된다.
- [x] 기존 published 지식이 손상 없이 유지된다.

## 리스크·메모

- 모델 분리 vs `documents` 확장은 트레이드오프 — PoC에서는 **별도 컬렉션 + linkedDocId 연결** 권장(published와 라이프사이클 분리).
- freshness(`latest/needs_update/conflict`) 기존 표시와 신뢰 라벨이 충돌하지 않도록 매핑 규칙을 PR-26 매핑표에 맞춘다.
