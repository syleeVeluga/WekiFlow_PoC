# plans — 남은 작업 (Remaining Work)

아직 구현하지 않은 작업. 완료되면 해당 문서를 `../archive/`로 옮긴다.

## 1. 워크스페이스 인가 (보안, Open)

- [`workspace-authorization.md`](./workspace-authorization.md) — `POST /api/workspaces/:workspaceId/ingestions`가 `workspaceId`를 검증 없이 신뢰한다. 워크스페이스 레지스트리/멤버십 모델 부재로 인한 인가 공백. 멱등성 스코프 소유자 바인딩으로 부분 완화됨, 나머지는 미해결.

## 2. 개발자/슈퍼어드민 제어판 (런타임 config)

- [`dev-control-panel.md`](./dev-control-panel.md) — 에이전트 프롬프트·인자/한도·모델·정책(policy.yaml)을 재배포 없이 런타임 편집하는 슈퍼어드민 전용 패널. 접근은 역할 사다리와 분리된 직교 플래그 `isSuperAdmin`로 통제(WKF 후 권한 개편에 영향 없음). **계획 확정, 미착수.**

## 3. OKF 선택(🟡) PR — 완료

핵심 PR(01~18)은 구현 완료(`../archive/okf-knowledge-standard/implementation/`). 선택(opt-in) PR-19/20도 완료되어 `../archive/`로 이동했다.

> 설계 근거는 [`../reference/okf-knowledge-standard/`](../reference/okf-knowledge-standard/), 조사·통합계획은 [`../archive/okf-knowledge-standard/`](../archive/okf-knowledge-standard/).
