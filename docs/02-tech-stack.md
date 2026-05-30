# 02. 기술 스택 & 의존성 매트릭스 (Tech Stack & Dependencies)

> 모든 버전은 **2026년 5월 기준** 웹 검색으로 검증한 최신 안정 버전입니다.
> 설치 직전 `npm view <pkg> version` 으로 패치 버전 재확인을 권장합니다.
> *All versions verified against the latest stable releases as of May 2026.*

---

## 1. 런타임 기반 (Runtime Foundation)

| 항목 | 버전 (Pin) | 근거 / 주의 (Rationale / Caveat) |
| :--- | :--- | :--- |
| **Node.js** | **24.x LTS** | 2026년 5월 기준 Active LTS. npm 11, 최신 V8. (Node 26은 Current이나 LTS는 2026-10 진입 — 프로덕션엔 24 권장) |
| **pnpm** | **10.x** | 모노레포 워크스페이스. 디스크 효율·엄격한 의존성 격리. |
| **TypeScript** | **5.9.x** | 전 패키지 공통. `"module": "NodeNext"`, ESM 기준. |
| **패키지 매니저 전략** | pnpm workspaces (monorepo) | `apps/*`(web, api), `workers/*`(main, graph), `packages/*`(shared, agent-tools, sandbox) |

> ⚠️ Vite 8은 Node 20.19+ / 22.12+ 이상 요구. Node 24 LTS면 안전. dockerode/네이티브 모듈 빌드 위해 `build-essential`/`python3` 필요할 수 있음.

---

## 2. 프론트엔드 (Frontend)

| 패키지 | 버전 (Pin) | 역할 |
| :--- | :--- | :--- |
| `vite` | **^8.0** (최신 8.0.14) | 빌드/HMR. Vite 7 이하는 EOL — 8 사용. |
| `@vitejs/plugin-react` | **최신(8 호환)** | React Fast Refresh. |
| `react` / `react-dom` | **^19** | React 19. (create-vite 기본은 18 → 수동 업그레이드 필요) |
| `@blocknote/core` | **^0.50** | 블록 기반 에디터 코어. |
| `@blocknote/react` | **^0.50** (최신 0.50.0) | Notion-스타일 열람/편집 UI. MPL-2.0(상용 가능). |
| `@blocknote/mantine` | **^0.50** | 기본 테마(Mantine). |
| `@monaco-editor/react` | **^4.7** (4.7.0) | `DiffEditor` 컴포넌트로 정밀 검토. React 19는 `@4.7.0-rc`(`@next`)도 확인. |
| `monaco-editor` | **최신** | 위 래퍼의 피어. Vite는 `vite-plugin-monaco-editor` 또는 `?worker` 임포트로 워커 설정. |
| `@tanstack/react-query` | **^5** | 서버 상태/캐시. SSE/폴링 처리. |
| `zustand` | **^5** | 경량 클라이언트 상태(에디터 토글 등). |
| `tailwindcss` | **^4** | 스타일링(선택). v4는 설정 방식 변경에 유의. |

> ⚠️ **BlockNote ↔ Monaco 토글**: 두 에디터를 동시 마운트하지 말고, 상태(`viewMode`)에 따라 **조건부 렌더링**. Monaco는 무겁기 때문에 lazy import 권장. BlockNote 콘텐츠는 마크다운으로 직렬화하여 Monaco Diff의 `original`/`modified`에 주입.

---

## 3. 에이전트 코어 (Agent Core)

| 패키지 | 버전 (Pin) | 역할 |
| :--- | :--- | :--- |
| `ai` (Vercel AI SDK) | **^6.0** (최신 6.0.193) | 듀얼 파이프라인 오케스트레이션. v6의 **`Agent`/`ToolLoopAgent`** 추상화 사용. |
| `@ai-sdk/openai` | **최신** | OpenAI 프로바이더(LLM + 임베딩). |
| `@ai-sdk/anthropic` | **최신(선택)** | Claude 프로바이더(대체/이중화). |
| `zod` | **^3 또는 ^4** | Tool `inputSchema`/`outputSchema` 정의. AI SDK 6 권장 버전에 맞춤. |

> ℹ️ **AI SDK 5 → 6 변경 핵심**: `parameters`→`inputSchema`, `UIMessage`/`ModelMessage` 분리, SSE 네이티브 스트리밍, `Agent` 클래스(모델·instructions·tools를 1회 정의 후 재사용). 본 프로젝트는 v6 `Agent` 패턴으로 파이프라인 A/B를 각각 정의한다.

---

## 4. 큐 & 백본 (Queue & Broker)

| 패키지 | 버전 (Pin) | 역할 |
| :--- | :--- | :--- |
| `bullmq` | **^5.77** (최신 5.77.x) | Main Queue / Graph Queue 분리. Worker 동시성·재시도·rate-limit. |
| `ioredis` | **^5** | BullMQ가 권장하는 Redis 클라이언트. |
| **Redis** (서버) | **7.x**(컨테이너) | BullMQ 백본. `maxmemory-policy noeviction` 권장. |

> ⚠️ BullMQ는 Redis 키 이빅션 시 잡 유실 위험 → `noeviction` 필수. Queue별 별도 `prefix`로 네임스페이스 분리.

---

## 5. 데이터 계층 (Data Layer)

| 패키지 | 버전 (Pin) | 역할 |
| :--- | :--- | :--- |
| `mongodb` (Node Driver) | **^6.18** (최신 v6.18) | 단일 드라이버로 문서/벡터/그래프 모두 처리. |
| **MongoDB** (서버) | **Atlas** 또는 **8.x(self-host)** | `$vectorSearch`는 **Atlas Vector Search** 또는 Atlas CLI 로컬 배포 필요. 일반 그래프는 `$graphLookup`(Community도 가능). |
| `minio` (minio-js) | **8.x 라인** (설치 시 `npm view minio version`로 확정) | S3 호환 클라이언트. 원본/MD/이미지, 샌드박스 마운트 소스. |
| `@types/minio` | (필요 시) | 일부 버전은 자체 타입 포함 — 중복 설치 주의. |

> ⚠️ **`$vectorSearch` 제약**: Atlas 전용 스테이지. 로컬 개발은 **Atlas CLI 로컬 배포** 또는 **Atlas 무료 클러스터**를 사용. 완전 self-host가 필수라면 대안: 임베딩을 `chunks`에 저장 후 코사인 유사도를 애플리케이션/`$function`으로 근사. (Phase 0에서 결정)
> ℹ️ 사용자가 확정한 **"MongoDB JSON 그래프 저장"** = 트리플을 `kg_nodes`/`kg_edges` 컬렉션에 일반 도큐먼트로 저장하고 `$graphLookup`으로 멀티홉. Neo4j 불필요.

---

## 6. 샌드박스 (Sandboxing — 격리 Docker 확정)

| 패키지 | 버전 (Pin) | 역할 |
| :--- | :--- | :--- |
| `dockerode` | **^5.0** (5.0.0) | Docker Engine API 클라이언트. 일회성 컨테이너 생성/exec/제거. |
| **Docker Engine** | **최신 안정** | 호스트에 설치. `--no-network`, `--read-only`, cgroup 제한 등 하드닝. |
| 베이스 이미지 | `python:3.13-slim` 또는 커스텀 | grep/awk/python + ripgrep 포함한 경량 이미지 빌드. |

상세 격리/보안 설계는 [`05-sandbox-security.md`](./05-sandbox-security.md).

---

## 7. 임베딩 & 모델 (Embeddings & Models)

| 용도 | 옵션 (권장 순) | 비고 |
| :--- | :--- | :--- |
| **임베딩** | OpenAI `text-embedding-3-large`(3072d) / `-small`(1536d), 또는 Voyage AI | MongoDB Vector Search 인덱스의 `numDimensions`와 반드시 일치. |
| **메인 에이전트 LLM** | tool-calling 강한 모델(예: GPT 계열 / Claude 계열) | 긴 컨텍스트·정확한 함수호출 우선. |
| **트리플 추출 LLM** | 동일 또는 비용 효율 모델 | 구조화 출력(JSON) 신뢰도 중시. |
| **자동 임베딩** | MongoDB **Automated Embedding**(2026-05 Public Preview) | 임베딩 코드 없이 텍스트 자동 임베딩 — PoC 단순화에 고려. |

> 모델명은 변동성이 크므로 코드에서 **환경변수(`EMBEDDING_MODEL`, `AGENT_MODEL`)로 주입**하고 하드코딩하지 않는다.

---

## 8. 개발 도구 (Dev Tooling)

| 패키지 | 역할 |
| :--- | :--- |
| `tsx` | TS 직접 실행(워커/스크립트 개발). |
| `vitest` | 단위/통합 테스트. |
| `eslint` + `@typescript-eslint` + `prettier` | 린트/포맷. |
| `docker compose` | 로컬 인프라(Redis/MongoDB/MinIO) 오케스트레이션. |
| `pino` + `pino-pretty` | 구조화 로깅(워커 관측성). |

---

## 9. 의존성 호환성 체크리스트 (Compatibility Checklist)

- [ ] Node **24 LTS** 고정(`.nvmrc`, `engines` 필드).
- [ ] Vite **8** ↔ Node 24 OK. React **19** ↔ `@monaco-editor/react` 4.7(필요 시 `@next`) 확인.
- [ ] `ai@6` ↔ `zod` 버전 정합(AI SDK 6가 요구하는 zod major 확인 후 통일).
- [ ] `bullmq@5` ↔ `ioredis@5` ↔ Redis 7 OK.
- [ ] `mongodb@6.18` ↔ MongoDB 서버 8 / Atlas OK. `$vectorSearch` 가용성(Atlas) 확인.
- [ ] `dockerode@5` ↔ 호스트 Docker Engine 소켓 접근 권한 확인.
- [ ] ESM 전역: 모든 `package.json`에 `"type": "module"`.

> 위 체크리스트는 Phase 0 종료 게이트의 일부다. (`06-phase-0-foundation.md` 참조)
