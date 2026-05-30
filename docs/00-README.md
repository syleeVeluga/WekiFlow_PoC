# WekiFlow 구현 계획 문서 (Implementation Plan Index)

> **WekiFlow (위키플로우)** — Hybrid RAG(Vector + Graph) & Sandboxed Terminal 기반 엔터프라이즈 지식 형상관리 워크스페이스
> *An enterprise knowledge configuration-management workspace built on Hybrid RAG and a sandboxed agent terminal.*

본 `docs/` 폴더는 [WekiFlow PRD v4.0](../WekiFlow%20PRD%20v4.0.md)을 분석하여 **AI 페어 프로그래밍(AI-assisted coding)** 으로 바로 착수할 수 있도록 작성된 단계별 구현 계획입니다. 모든 라이브러리/SDK 버전은 **2026년 5월 기준 최신 안정 버전**으로 검증되었습니다.

---

## 확정된 핵심 결정 (Locked Decisions)

| 항목 (Item) | 결정 (Decision) | 비고 (Note) |
| :--- | :--- | :--- |
| **샌드박스 런타임** | **격리 Docker** (self-hosted, dockerode 제어) | E2B 대신 자체 호스팅. 인프라 통제권·보안 격리 직접 관리. |
| **지식 그래프 저장소** | **MongoDB (JSON 트리플 저장)** | Neo4j 미사용. 트리플을 `kg_nodes`/`kg_edges` 컬렉션에 JSON으로 저장, `$graphLookup`으로 멀티홉 추론. |
| **벡터 DB** | **MongoDB Atlas Vector Search** | 청크 임베딩 + `$vectorSearch`. 그래프와 동일 클러스터에 통합. |
| **문서 언어/깊이** | **한·영 병기, 상세 수준** | AI 코딩에 바로 쓸 수 있는 파일/함수/명령 단위까지 기술. |

---

## 문서 구성 (Document Map)

순서대로 읽으면 PoC → 프로덕션까지 자연스럽게 이어집니다.

| # | 파일 | 내용 (Contents) |
| :--- | :--- | :--- |
| 01 | [`01-architecture.md`](./01-architecture.md) | 시스템 아키텍처, 듀얼 파이프라인(A/B), 컴포넌트 다이어그램 |
| 02 | [`02-tech-stack.md`](./02-tech-stack.md) | 검증된 최신 버전 매트릭스 + 의존성 호환성 + 선택 근거 |
| 03 | [`03-data-model.md`](./03-data-model.md) | MongoDB 컬렉션 스키마(문서/청크/벡터/그래프/잡) |
| 04 | [`04-agent-tools.md`](./04-agent-tools.md) | Vercel AI SDK Tool 명세 6종(상세 시그니처 포함) |
| 05 | [`05-sandbox-security.md`](./05-sandbox-security.md) | 격리 Docker 설계, dockerode 구현, 보안 하드닝 |
| 06 | [`06-phase-0-foundation.md`](./06-phase-0-foundation.md) | **Phase 0** — 모노레포 스캐폴딩 & 로컬 인프라(docker-compose) |
| 07 | [`07-phase-1-editor-ui.md`](./07-phase-1-editor-ui.md) | **Phase 1** — 투트랙 에디터 UI + 백엔드 뼈대 + 메인 큐 |
| 08 | [`08-phase-2-sandbox-pipeline-a.md`](./08-phase-2-sandbox-pipeline-a.md) | **Phase 2** — 샌드박스 터미널 통합 (파이프라인 A 코어) |
| 09 | [`09-phase-3-graph-pipeline-b.md`](./09-phase-3-graph-pipeline-b.md) | **Phase 3** — LightRAG 트리플 추출 (파이프라인 B 코어) |
| 10 | [`10-phase-4-hybrid-rag.md`](./10-phase-4-hybrid-rag.md) | **Phase 4** — 궁극의 하이브리드 RAG 통합 |
| 11 | [`11-testing-and-verification.md`](./11-testing-and-verification.md) | 테스트 전략 + PRD 권장 2대 코어 PoC 스크립트 |
| 12 | [`12-roadmap-and-milestones.md`](./12-roadmap-and-milestones.md) | 타임라인, 의존성, 리스크, 완료 기준(DoD) |

---

## 빠른 시작 (TL;DR for AI Coding)

1. **Phase 0** 먼저 — `06-phase-0-foundation.md`의 `docker-compose.yml`로 Redis/MongoDB/MinIO를 띄우고 pnpm 모노레포를 스캐폴딩한다.
2. **2대 코어 PoC를 최우선** — PRD 권고대로 ① 샌드박스 grep 실행 테스트, ② LightRAG 추출 프롬프트 테스트를 먼저 통과시킨다. (`11-testing-and-verification.md`)
3. 이후 Phase 1 → 4 순서로 진행. 각 Phase 문서 끝의 **"완료 기준(Definition of Done)"** 을 게이트로 사용한다.

---

## 표기 규약 (Conventions)

- 📦 = 설치할 패키지, 🛠️ = 구현 작업, ✅ = 완료 기준(DoD), ⚠️ = 주의/리스크.
- 코드 블록의 버전은 **상한 핀(pin)** 기준. 실제 설치 직전 `npm view <pkg> version`으로 패치 버전을 재확인할 것.
- 모든 백엔드 코드는 **TypeScript(ESM) + Node.js 24 LTS** 기준.
