# Phase 0 — 기반 구축 (Foundation: Monorepo & Local Infra)

> PRD 로드맵에는 없지만, 거대한 구조의 안정적 착수를 위해 **선행 기반 단계**를 추가합니다.
> *A prerequisite step before PRD Phase 1: scaffold the monorepo and stand up local infra.*

목표: 코드를 한 줄 쓰기 전에 **로컬에서 Redis·MongoDB·MinIO가 뜨고**, pnpm 모노레포가 빌드되며, DB 인덱스가 멱등 생성되는 상태.

---

## 1. 모노레포 구조 (Monorepo Layout)

```
wekiflow/
├─ package.json                # pnpm workspaces 루트
├─ pnpm-workspace.yaml
├─ .nvmrc                      # 24
├─ tsconfig.base.json
├─ docker-compose.yml          # Redis + MongoDB + MinIO
├─ docker/
│  └─ sandbox/Dockerfile       # 에이전트 샌드박스 이미지 (05 문서)
├─ apps/
│  ├─ web/                     # Vite + React 19 (Phase 1)
│  └─ api/                     # Fastify API 서버 (Phase 1)
├─ workers/
│  ├─ main/                    # 파이프라인 A 워커 (Phase 2)
│  └─ graph/                   # 파이프라인 B 워커 (Phase 3)
└─ packages/
   ├─ shared/                  # 타입, zod 스키마, 상수(상태 enum 등)
   ├─ db/                      # MongoDB 클라이언트 + ensureIndexes + repo
   ├─ queue/                   # BullMQ 큐/워커 팩토리
   ├─ storage/                 # MinIO 클라이언트 래퍼
   ├─ sandbox/                 # SandboxRunner(Docker) (05 문서)
   └─ agent-tools/             # Vercel AI SDK Tools + Agent 정의 (04 문서)
```

---

## 2. 작업 목록 (Tasks)

### 🛠️ 2.1 워크스페이스 초기화

📦 설치(루트):
```bash
corepack enable && corepack prepare pnpm@latest --activate
node -v   # v24.x 확인
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "workers/*"
  - "packages/*"
```

루트 `package.json`(요지): `"type": "module"`, `engines.node: ">=24 <25"`, 공통 devDeps(`typescript@5.9`, `tsx`, `vitest`, `eslint`, `prettier`, `pino`).

`tsconfig.base.json`(요지): `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"target": "ES2023"`, `"strict": true`.

### 🛠️ 2.2 로컬 인프라 — `docker-compose.yml`

```yaml
services:
  redis:
    image: redis:7-alpine
    command: ["redis-server", "--maxmemory-policy", "noeviction"]
    ports: ["6379:6379"]
    volumes: ["redis-data:/data"]

  mongo:
    image: mongo:8                # 일반 CRUD/$graphLookup 용. $vectorSearch는 §3 참고.
    ports: ["27017:27017"]
    volumes: ["mongo-data:/data/db"]

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports: ["9000:9000", "9001:9001"]
    volumes: ["minio-data:/data"]

volumes:
  redis-data: {}
  mongo-data: {}
  minio-data: {}
```

```bash
docker compose up -d
```

### 🛠️ 2.3 `packages/db` — 클라이언트 & 인덱스

- `client.ts`: `MongoClient`(mongodb@6.18) 싱글턴.
- `ensureIndexes.ts`: [`03-data-model.md`](./03-data-model.md)의 모든 일반 인덱스를 멱등 생성.
- repo 모듈: `documentsRepo`, `chunksRepo`, `kgRepo`, `jobsRepo`.

### 🛠️ 2.4 `packages/storage` — MinIO

- 버킷 부트스트랩: `documents`, `assets`. (없으면 생성)
- 헬퍼: `putObject`, `getObject`, `syncDocsToDir(prefix, localDir)`(샌드박스 마운트용 동기화).

### 🛠️ 2.5 `packages/queue` — BullMQ

- `Queue` 팩토리: `mainQueue`(`prefix: wf:main`), `graphQueue`(`prefix: wf:graph`).
- `Worker` 팩토리: 동시성/재시도(`attempts`, `backoff`) 기본값.
- `ioredis` 연결 공유, graceful shutdown 훅.

### 🛠️ 2.6 `packages/shared` — 타입/상수

- 문서 상태 enum, 잡 타입 enum, zod 스키마(문서/청크/트리플/잡).
- 환경변수 스키마(zod)로 부팅 시 검증: `MONGODB_URI`, `REDIS_URL`, `MINIO_*`, `EMBEDDING_MODEL`, `AGENT_MODEL`, provider API key(`OPENAI_API_KEY`, 필요 시 `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`), `DOCKER_SOCKET`.

---

## 3. ⚠️ Vector Search 결정 (Phase 0에서 확정)

`$vectorSearch`는 **Atlas 전용** 스테이지다. 로컬 self-host Mongo(`mongo:8`)에서는 동작하지 않는다. 셋 중 택1:

| 옵션 | 방법 | 트레이드오프 |
| :--- | :--- | :--- |
| **A. Atlas 클라우드**(권장) | 무료/공유 클러스터에 `chunks` 호스팅, 나머지는 동일 클러스터 | 가장 단순, 클라우드 의존 |
| **B. Atlas CLI 로컬 배포** | `atlas deployments setup --type local` 로 로컬 Atlas | 로컬 완전 재현, 셋업 추가 |
| **C. 애플리케이션 코사인** | 임베딩을 `chunks`에 저장, Node에서 코사인 유사도 계산 | Atlas 불필요, 대규모엔 부적합(PoC만) |

> PoC 단계에서는 **A 또는 C**를 권장. 본 계획은 인터페이스(`tool_search_vector`)를 추상화해 두므로, 구현체만 교체하면 된다. 선택 결과를 `02-tech-stack.md` 체크리스트에 반영할 것.

---

## 4. ✅ 완료 기준 (Definition of Done) — ✅ 완료 (2026-05-30)

- [x] `docker compose up -d` 후 Redis/Mongo/MinIO 헬스 OK.
- [x] `pnpm -r build` 전 패키지 빌드 성공(빈 스텁이라도).
- [x] `pnpm --filter @wf/db exec tsx src/ensureIndexes.ts` 실행 시 인덱스 멱등 생성. (`ensure-indexes` 스크립트로 2회 연속 통과)
- [x] MinIO 콘솔(`:9001`)에서 `documents`/`assets` 버킷 확인. (`@wf/storage ensure-buckets`)
- [x] 환경변수 zod 검증 통과(누락 시 친절한 에러).
- [x] `docker/sandbox/Dockerfile` 빌드 성공(`docker build -t wekiflow/sandbox docker/sandbox`).
- [x] [`02-tech-stack.md` §9 호환성 체크리스트](./02-tech-stack.md) 통과 (단, `ai@6`는 Phase 2 도입 예정 — §9 주석 참고).

> ✅ 게이트 통과 — 검증 증거는 [`14-goal-completion-audit.md`](./14-goal-completion-audit.md) 1차 점검 표 참조. **Phase 1**과 **2대 코어 PoC**도 함께 완료됨.
