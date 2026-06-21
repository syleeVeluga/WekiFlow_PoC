# Terminology Map

> 조기 작성: PR-32 docs follow-up(2026-06-21). PR-35 cleanup에서 이 표를 기준으로 일반 사용자 화면의 내부 용어 노출을 정리한다.

## 원칙

- 일반 사용자 화면은 제품 흐름 언어를 사용한다.
- OKF/WKF, pipeline, tool, triplet 같은 내부 구현 용어는 Agent Preview, Dev Panel, 개발자 문서처럼 디버그/운영 맥락에서만 허용한다.
- 새 화면은 이 표의 사용자-facing 용어를 우선 사용하고, 예외가 필요하면 해당 PR 문서에 근거를 남긴다.

## 매핑

| 내부 개념 | 사용자-facing 용어 | 처리 | 허용 위치 |
| :--- | :--- | :--- | :--- |
| OKF/WKF concept | 지식 카드 | 리네임 | 일반 화면, 문서 |
| raw source / reference | 원본 | 리네임 | 일반 화면, 문서 |
| enrichment/main agent | AI 정리 초안 | 리네임 | 일반 화면, 문서 |
| conversation learner | 대화에서 저장 | 리네임 | 일반 화면, 문서 |
| curation agent | 지식 정리 제안 | 리네임 | 일반 화면, 문서 |
| review gate | 승인 필요 | 리네임 | 일반 화면, 문서 |
| discovery agent | 지식에 질문하기 | 리네임 | 일반 화면, 문서 |
| learner proposal | 부족한 지식 | 리네임 | 일반 화면, 문서 |
| OKF bundle visualization | 지식 맵 | 리네임 | 일반 화면, 문서 |
| `# Relations` / typed KG | 관계 인덱스 | 숨김 또는 고급 토글 | 지식 맵 advanced/debug |
| `tool_*` | 내부 도구 실행 | 숨김 | Agent Preview, Dev Panel |
| Pipeline A/B/C/D | 처리 단계 | 숨김 또는 리네임 | Agent Preview, Dev Panel |
| triplet/triple | 관계 추출 결과 | 숨김 또는 리네임 | Agent Preview, Dev Panel |

## PR별 사용

- PR-33 지식 맵: 화면명은 "지식 맵"을 사용하고, typed relation/KG는 advanced toggle 문구로 제한한다.
- PR-34 Discovery Trust: 화면명은 "지식에 질문하기"를 사용하고, citation/source는 "출처"와 "신뢰 상태"로 표시한다.
- PR-35 Simplification Cleanup: 일반 화면 grep 게이트(`WKF|OKF|pipeline|파이프라인|tool_|triplet`)를 이 표의 허용 위치 기준으로 판정한다.

## PR-35 grep gate

일반 사용자 화면(`apps/web/src/components/add`, `ask`, `conversation`, `doc`, `home`, `kb`, `lnb`, `map`, `review`, `trash`)에서는 다음 내부 용어가 보이면 실패로 본다.

- `WKF`
- `OKF`
- `pipeline`
- `파이프라인`
- `tool_`
- `triplet` / `triple`

검토 화면의 사용자-facing 문자열에서는 `Triage`, `Layer 1`, `Multi-source`, `Type A/B/C/D`도 각각 `후보 분류`, `AI 정리`, `여러 출처`, `동일 변경/버전 선택/충돌 확인/부분 반영`으로 표시한다.

허용 위치:

- `apps/web/src/components/agent/AgentPreviewPage.tsx` — OWNER 전용 실행/관계 추출 디버그 화면.
- `apps/web/src/components/admin/DevPanel.tsx` — super admin 전용 런타임 설정 화면.
- `apps/web/src/lib/docId.ts` — 사용자에게 보이지 않는 코드 주석.
- `docs/reference`, `docs/archive`, `docs/plans` — 내부 설계/이력/계획 문서.

## PR-35 acceptance gate

Overview §8 완료 기준은 PR-35 이후 다음 증거로 판정한다.

- 실제 코드 경로: `Gap-Analysis.md`의 화면/API 인벤토리와 PR-26~34 완료 기록.
- 후보와 published 경계: `candidate-state-machine.md`, PR-27 신뢰 라벨, PR-32 review triage.
- Enrichment Draft 범위: PR-28 완료 기록과 `agent-surface-contract.md`.
- 대화 provenance 정책: PR-30/31 완료 기록과 Conversation Save 화면.
- Knowledge Map v1 범위: PR-33 링크 그래프와 "지식 맵" 화면.
- PR 단위 계획: `PR-Plan.md`의 PR-26~35 완료 상태.
- 사용자-facing 용어: 이 문서의 grep gate와 `넣기 → AI 정리 → 확인/승인 → 질문/탐색` 화면 흐름 검증.
