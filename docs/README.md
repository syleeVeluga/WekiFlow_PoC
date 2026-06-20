# WekiFlow 문서 맵 (Documentation Map)

WekiFlow는 Hybrid RAG(Vector + Graph)와 자체 호스팅 Docker 샌드박스를 결합한 엔터프라이즈 지식 형상관리 워크스페이스다. 현재 시스템은 **OKF 기반 지식표준(WKF)** 으로 구현돼 있다(설계는 `reference/okf-knowledge-standard/`).

문서는 세 버킷으로 정리한다.

| 폴더 | 용도 | 성격 |
| :--- | :--- | :--- |
| [`reference/`](./reference/) | 현재 구현된 시스템의 설계·스펙. **작업 전 참고**한다. | 살아있는 문서 |
| [`plans/`](./plans/) | 아직 안 한 **남은 작업**. | 진행 예정 |
| [`archive/`](./archive/) | 완료된 계획·조사·이력. **역사적 기록**(링크 일부 깨질 수 있음). | 보존용 |

> 루트 [`AGENTS.md`](../AGENTS.md)가 AI 코딩 에이전트의 1차 진입점이다. `WekiFlow PRD v4.0`은 제품 의도의 원본이며 [`archive/WekiFlow-PRD-v4.0.md`](./archive/WekiFlow-PRD-v4.0.md)에 보관한다.

---

## reference/ — 참고

- [`main-agent-architecture.md`](./reference/main-agent-architecture.md) — 메인 인입 파이프라인(Pipeline A) 에이전트 구조·모델 매핑.
- [`okf-knowledge-standard/`](./reference/okf-knowledge-standard/) — WKF 지식표준 설계·스펙(구현된 시스템의 근거).
  - `04` WKF 포맷 스펙 · `05` 큐레이션 에이전트(Pipeline C) · `07` 포맷·생성·적합성 · `08` Learner/Discovery 에이전트 스펙 · `09` enrichment 하니스·동기화.
- WKF 런타임 스펙은 패키지 안에 함께 산다: [`packages/wkf/SPEC.md`](../packages/wkf/SPEC.md).
- 프론트엔드 디자인 원본: [`Design Reference/v-wiki.html`](./Design%20Reference/v-wiki.html) — `scripts/extract-wiki-seed.mjs`가 이 파일을 읽으므로 이동 금지.

## plans/ — 남은 작업

[`plans/README.md`](./plans/README.md) 참고.

- [`workspace-authorization.md`](./plans/workspace-authorization.md) — 외부 인입 API 워크스페이스 인가 공백(Open 보안 TODO).

## archive/ — 완료·이력

- `00`–`17` — 초기 Phase 0–4 아키텍처 설계 + 완료 감사(피벗 이전).
- `frontend-ui/` — WikiFlow UI 단계별 구현 계획(완료).
- `18`–`21` — 조직지식 UI 리스타일 / 에이전트 미리보기 / Layer1 파이프라인 통합 / 직접추가(모두 구현 완료).
- OKF 선택 PR: [`okf-pr-19-external-enrichment.md`](./archive/okf-pr-19-external-enrichment.md), [`okf-pr-20-mcp-and-connectors.md`](./archive/okf-pr-20-mcp-and-connectors.md).
- `okf-knowledge-standard/` — OKF 도입 조사·제안·통합실행계획 + 구현기록(PR-01~20 완료).
