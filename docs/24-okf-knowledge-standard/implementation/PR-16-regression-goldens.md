# PR-16 — `evalCandidate` → 회귀 골든셋

> Phase 7 · 선행: PR-15 · 근거: [`08` §A.1](../08-agent-implementation-specs.md)

## 목표
러너가 추출한 성공 사례(`evalCandidate`: 질문→정답)를 회귀 골든셋으로 적재하고, 검색/응답 품질 회귀를 감지하는 평가 잡을 만든다.

## 범위
- **In:** 골든셋 저장, `eval` 스크립트(골든셋으로 Discovery/검색 회귀 측정), CI 리포트.
- **Out:** Discovery 구현 자체(PR-17/18).

## 변경 파일
- 🆕 `packages/db`(goldens 컬렉션 또는 `knowledge/eval/goldens.json`)
- 🆕 `scripts/eval-retrieval.ts`

## 구현 단계
1. 러너(PR-15)의 `evalCandidate.valid=true`인 (intent, goldenAnswer)를 골든셋에 적재(중복 제거).
2. `eval-retrieval.ts`: 골든 질문으로 검색/응답 실행 → 기대 결과 포함 여부(재현율/정확도) 측정 → 리포트.
3. CI(야간 또는 PR 라벨)로 회귀 임계 하락 시 경고.

## 테스트
- 골든셋 적재 멱등.
- eval 스크립트가 픽스처에서 재현율 계산.

## DoD
- [ ] 성공 사례가 골든셋에 누적된다.
- [ ] eval 스크립트가 회귀를 수치로 보고한다.

## 리스크·메모
- 골든셋은 시간이 지나며 가치 누적 — 초기엔 작아도 됨.
- 변경에 취약한 "정확 일치"보다 "기대 문서 포함" 기준 권장.
