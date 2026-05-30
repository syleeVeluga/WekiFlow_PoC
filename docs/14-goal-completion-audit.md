# 14. GOAL.md 완료 감사

작성일: 2026-05-30

이 문서는 `GOAL.md`의 1차, 2차, 3차 중간 점검 목표를 현재 워크트리 기준으로 검증한 결과다.

## 1차 중간 점검: Phase 0 완료

| 요구사항 | 증거 |
| :--- | :--- |
| pnpm 모노레포 구조 | `pnpm-workspace.yaml`, `apps/*`, `workers/*`, `packages/*` |
| Node 24 LTS | `node -v` 결과 `v24.13.0` |
| TypeScript strict, ESM, NodeNext | `tsconfig.base.json`, 루트/패키지 `package.json`의 `"type": "module"` |
| Redis/MongoDB/MinIO 기동 | `docker compose up -d`, `docker compose ps`에서 3개 서비스 Up |
| 패키지 최소 스텁 빌드 | `corepack pnpm build` 통과 |
| MongoDB 인덱스 멱등 생성 | `corepack pnpm --filter @wf/db ensure-indexes` 2회 연속 통과 |
| MinIO 버킷 생성 | `corepack pnpm --filter @wf/storage ensure-buckets` 통과 |
| 샌드박스 Dockerfile 빌드 | `docker build -t wekiflow/sandbox:latest docker/sandbox` 통과 |
| Vector Search 방식 결정 | `docs/13-implementation-decisions.md`, `.env.example`의 `VECTOR_SEARCH_MODE=app-cosine` |

## 2차 중간 점검: 코어 PoC 2종 통과

| 요구사항 | 증거 |
| :--- | :--- |
| 샌드박스 `rg` 원문 검색 | `corepack pnpm poc:sandbox`가 `제4조 2항 ... 연차 15일` 라인 출력 |
| 네트워크 차단 | `poc-sandbox-grep.ts`에서 Python `urllib` 외부 호출 실패를 통과 조건으로 검사 |
| read-only 마운트 | `poc-sandbox-grep.ts`에서 `/docs` 쓰기 실패를 통과 조건으로 검사 |
| 리소스 제한 | `poc-sandbox-grep.ts`에서 512MB 할당 실패를 통과 조건으로 검사 |
| 컨테이너 제거 | `poc-sandbox-grep.ts`에서 `docker ps -a --filter ancestor=wekiflow/sandbox:latest`가 비어 있음을 검사 |
| timeout cleanup | timeout 발생 시 고유 이름의 샌드박스 컨테이너를 `docker rm -f`로 회수하고, 실제 timeout 재현 후 잔여 컨테이너가 없음을 확인 |
| LightRAG 추출 스키마 | `corepack pnpm poc:lightrag`가 `TripletArraySchema` 검증 통과 |
| 핵심 관계 추출 | `신입사원 -> 연차 15일`, `연차 사용 신청 -> 부서장` 출력 |
| 반복 안정성 | `poc-lightrag-extract.ts`가 동일 입력 2회 결과 동등성을 검사 |

## 3차 중간 점검: Phase 1 골격 동작

| 요구사항 | 증거 |
| :--- | :--- |
| BlockNote/Monaco 조건부 렌더링 | `apps/web/src/components/HybridEditor.tsx`, `BlockNotePane.tsx`, `MonacoDiffPane.tsx` |
| 실제 BlockNote 패키지 사용 | `BlockNotePane.tsx`에서 `useCreateBlockNote`, `BlockNoteView` 사용 |
| Monaco Diff 비교 | `MonacoDiffPane.tsx`에서 `original=contentMarkdown`, `modified=draftMarkdown` 전달 |
| API 라우트 골격 | `apps/api/src/server.ts`의 `/api/tree`, `/api/documents/:id`, `/api/ingest`, `/api/reviews`, `approve`, `reject`, SSE |
| 인입 -> REVIEW | `apps/api/src/server.test.ts`, 최종 HTTP 검증 결과 `IngestStatus=REVIEW` |
| 승인 -> PUBLISHED + Graph Queue | 최종 HTTP 검증 결과 `ApprovedStatus=PUBLISHED`, `GraphJobType=EXTRACT_TRIPLETS` |
| RBAC 차단 | 최종 HTTP 검증 결과 `DeniedStatus=403` |
| 개발 서버 응답 | 웹 `http://localhost:5173` HTTP 200, API `http://localhost:4000/api/tree` HTTP 200 |

## 공통 질문

| 질문 | 상태 |
| :--- | :--- |
| Phase DoD 통과 여부 | Phase 0, 코어 PoC 2종, Phase 1 골격 기준 통과 |
| 감사 가능성 | `createJobsRepo().appendAgentStep`, `createSandboxRunsRepo().record`, `DockerSandboxRunner.audit`, `createMainTools().recordStep` 구현 |
| 멱등성 | 인덱스 생성 2회 통과, 트리플 upsert는 unique key 기반 |
| zod 검증 | shared 스키마, LightRAG PoC, 테스트에서 검증 |
| 불확실한 사실 보강 | 샌드박스 PoC가 `rg`로 원문 라인을 결정론적으로 확인 |
| 결정 사항 문서화 | `docs/13-implementation-decisions.md`, `AGENTS.md`, `.env.example` |

## 검증 명령 요약

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
corepack pnpm test
corepack pnpm poc:lightrag
corepack pnpm poc:sandbox
corepack pnpm --filter @wf/db ensure-indexes
corepack pnpm --filter @wf/storage ensure-buckets
docker compose ps
```

브라우저 플러그인 기반 시각 검증은 Node 기반 브라우저 런타임이 `windows sandbox failed: spawn setup refresh`로 두 차례 종료되어 수행하지 못했다. 대신 Vite production build, 웹 dev 서버 HTTP 200, API HTTP smoke를 완료 증거로 사용했다.
