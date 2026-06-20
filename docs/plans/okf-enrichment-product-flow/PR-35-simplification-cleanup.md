# PR-35 — Simplification Cleanup: 용어·노출 정리 (T7)

> Track T7 · 상태: 계획 · 선행: PR-27~34(표면 모델 도입 후 정리) · 근거: [`Overview.md`](./Overview.md) §2.1·§5.2-6·§6 GA-05, [`Gap-Analysis.md`](./Gap-Analysis.md) §3.6·§4.2
> 외부 API 메모: 없음.

## 목표

GA-05를 마무리한다. 새 표면 모델 도입 후 남은 내부 pipeline terminology를 정리하고, 사용자-facing 용어를 Overview §2.1로 일관화한다. OKF/WKF 노출은 이미 디버그 화면에 격리돼 있으므로 **리네임·숨김 위주의 경량 cleanup**이다.

## 범위

- **In:**
  - 유지/숨김/리네임/제거 후보 목록 확정·반영.
  - 사용자-facing 용어 일관화(지식 카드·원본·AI 정리 초안·승인 필요 등).
  - stub 페이지(`sources/rules/history`) 정리 또는 실기능 연결/제거.
  - 회귀 테스트·acceptance gate 정비.
- **Out:** 신규 기능(앞선 PR들), 내부 KG/pipeline 제거(유지).

## 변경 파일

- 🔧 `docs/plans/okf-enrichment-product-flow/contracts/terminology-map.md` — 내부↔사용자 용어 매핑·유지/숨김/리네임/제거 표(조기 작성됨).
- 🔧 `apps/web/src/**` — 잔존 내부 용어(pipeline A/B/C/D, WKF/OKF, tool_*) 사용자 화면 노출 제거·리네임.
- 🔧 `apps/web/src/store.ts` — `sources/rules/history` stub 결정 반영.
- 🔧 `docs/README.md`, `docs/plans/README.md` — 완료 항목 archive 이동·링크 갱신.

## 구현 단계

1. **인벤토리.** 사용자 화면에 남은 내부 용어 전수 조사(grep: `WKF|OKF|pipeline|tool_|triplet`). 디버그 전용(AgentPreview/DevPanel)은 유지, 일반 화면은 리네임/숨김.
2. **용어 매핑.** Overview §2.1 표(지식 카드/원본/AI 정리 초안/대화에서 저장/지식 정리 제안/승인 필요/지식에 질문하기/부족한 지식/지식 맵)로 통일. UI 문구·docs 동기화.
3. **stub 정리.** `sources/rules/history`를 실기능(예: connector 관리=PR-29) 연결 또는 제거. 내비게이션 정돈.
4. **acceptance gate.** Overview §8 완료 기준을 체크리스트화한 회귀 테스트/E2E 시나리오 추가.
5. **문서 이동.** 완료된 트랙 문서를 `docs/archive/`로 이동, README 링크 갱신.

## 테스트

- grep 게이트: 일반 사용자 화면에 금지 내부 용어 0건(디버그 화면 예외 허용 목록).
- E2E: 넣기→AI 정리→확인/승인→질문/탐색 핵심 시나리오 통과.
- 문서 링크: 깨진 상대 링크 0건.

## DoD

- [ ] 유지/숨김/리네임/제거 목록이 문서로 확정·반영됐다.
- [ ] 사용자-facing 용어가 Overview §2.1과 일치한다.
- [ ] OKF/WKF·pipeline 용어가 일반 화면에 노출되지 않는다.
- [ ] Overview §8 완료 기준이 acceptance gate로 검증된다.

## 리스크·메모

- 이 PR은 마지막이지만 **용어 매핑표는 조기 작성**되었다. PR-33/34는 `contracts/terminology-map.md`를 기준으로 UI 문구를 잡는다.
- 내부 KG·pipeline은 **제거가 아니라 노출만 정리**(Overview §1: 기존 구현 유지).
