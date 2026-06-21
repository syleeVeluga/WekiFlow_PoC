# reference — 참고 문서

현재 구현된 WekiFlow 시스템의 설계·스펙. 작업 전 관련 문서를 먼저 읽는다.

## 에이전트 / 파이프라인

- [`main-agent-architecture.md`](./main-agent-architecture.md) — 메인 인입 파이프라인(Pipeline A)의 `ToolLoopAgent` 구성, `tool_merge` 서브 합성기, 역할별 모델 매핑. 핵심 파일은 본문에 링크.

## OKF 기반 지식표준 (WKF)

[`okf-knowledge-standard/`](./okf-knowledge-standard/) — 구현된 지식표준의 설계 근거. (조사·제안·통합실행계획·완료 PR 기록은 `../archive/okf-knowledge-standard/`.)

| # | 문서 | 내용 |
| :--- | :--- | :--- |
| 04 | [`04-wekiflow-knowledge-spec.md`](./okf-knowledge-standard/04-wekiflow-knowledge-spec.md) | WKF v0.1 지식 포맷 스펙 |
| 05 | [`05-curation-agent.md`](./okf-knowledge-standard/05-curation-agent.md) | 큐레이션 에이전트(Pipeline C) 설계 |
| 07 | [`07-knowledge-format-and-generation.md`](./okf-knowledge-standard/07-knowledge-format-and-generation.md) | 포맷 템플릿·재현 생성·적합성 테스트 |
| 08 | [`08-agent-implementation-specs.md`](./okf-knowledge-standard/08-agent-implementation-specs.md) | Feedback Learner & Discovery 에이전트 스펙 |
| 09 | [`09-enrichment-harness-and-mdcode.md`](./okf-knowledge-standard/09-enrichment-harness-and-mdcode.md) | enrichment 하니스 + git↔서비스 동기화(낙관적 락) |

> 런타임 구현 스펙은 패키지와 함께: [`packages/wkf/SPEC.md`](../../packages/wkf/SPEC.md).
> 문서 번호(04·05·07~09)는 원본 OKF 폴더 번호를 유지한다. 01·02·03·06·10은 archive로 분리돼 일부 상호링크가 archive를 가리킨다.
## Current Testing

- [`testing.md`](./testing.md) - current test gates, empty Playwright API harness, and the core OKF Markdown upload pipeline E2E.
