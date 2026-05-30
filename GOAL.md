# WekiFlow 중간 점검 목표

이 문서는 `/goal` 요청에 맞춰 현재 저장소의 중간 점검 기준을 정리한 작업 목표 문서다. 목적은 문서 기반 계획을 실제 구현 작업으로 옮길 때, 어느 지점에서 품질과 방향을 확인할지 명확히 하는 것이다.

## 현재 목표

`docs/`의 구현 계획을 기준으로 WekiFlow PoC의 기반을 만들고, 가장 큰 기술 리스크인 Docker 샌드박스 팩트 확인과 LightRAG 트리플 추출을 조기에 검증한다.

## 1차 중간 점검: Phase 0 완료

점검 조건:

- pnpm 모노레포 구조가 `apps/*`, `workers/*`, `packages/*`로 생성되어 있다.
- Node 24 LTS, TypeScript strict, ESM, `NodeNext` 설정이 적용되어 있다.
- `docker-compose.yml`로 Redis 7, MongoDB 8, MinIO가 기동된다.
- `packages/shared`, `packages/db`, `packages/queue`, `packages/storage`, `packages/sandbox`, `packages/agent-tools`의 최소 스텁이 빌드된다.
- MongoDB 일반 인덱스 생성 스크립트가 멱등 실행된다.
- `docker/sandbox/Dockerfile`이 빌드된다.
- Atlas Vector Search 사용 방식이 결정되어 문서 또는 설정에 반영된다.

참고 문서:

- `docs/06-phase-0-foundation.md`
- `docs/02-tech-stack.md`
- `docs/03-data-model.md`
- `docs/05-sandbox-security.md`

## 2차 중간 점검: 코어 PoC 2종 통과

점검 조건:

- `scripts/poc-sandbox-grep.ts`가 격리 Docker 컨테이너에서 `/docs`의 테스트 문서를 `rg`로 검색한다.
- 샌드박스에서 네트워크 차단, read-only 마운트, 리소스 제한, 컨테이너 제거가 검증된다.
- `scripts/poc-lightrag-extract.ts`가 규정 문장을 zod 스키마에 맞는 트리플 JSON으로 추출한다.
- 반복 실행 시 핵심 관계가 안정적으로 나온다.

참고 문서:

- `docs/11-testing-and-verification.md`
- `docs/04-agent-tools.md`
- `docs/08-phase-2-sandbox-pipeline-a.md`
- `docs/09-phase-3-graph-pipeline-b.md`

## 3차 중간 점검: Phase 1 골격 동작

점검 조건:

- `apps/web`에서 BlockNote 열람/편집과 Monaco Diff 검토 모드가 조건부 렌더링으로 전환된다.
- `apps/api`에서 문서 트리, 문서 단건, 인입, 검토 목록, 승인/반려, SSE 라우트 골격이 동작한다.
- `/api/ingest`가 Main Queue에 잡을 넣고, 스텁 워커가 문서를 `REVIEW` 상태로 전환한다.
- 승인 시 `PUBLISHED` 전환과 Graph Queue enqueue가 확인된다.
- `ADMIN` 또는 `REVIEWER`가 아닌 사용자는 승인할 수 없다.

참고 문서:

- `docs/07-phase-1-editor-ui.md`
- `docs/01-architecture.md`
- `docs/03-data-model.md`

## 중간 점검 시 확인할 공통 질문

- 각 Phase의 Definition of Done을 빠짐없이 통과했는가?
- 샌드박스 실행 결과와 에이전트 도구 호출이 `jobs.agentSteps` 또는 `sandbox_runs`에 감사 가능하게 남는가?
- 큐 잡과 DB upsert가 재실행되어도 중복이나 상태 꼬임이 없는가?
- LLM 출력은 zod 스키마로 검증되는가?
- 불확실한 사실은 벡터 검색 결과만 믿지 않고 `rg` 기반 원문 확인으로 보강되는가?
- 새 결정 사항이 `docs/`와 `AGENTS.md`에 반영되었는가?

## 다음 작업 제안

1. Phase 0 스캐폴딩을 시작한다.
2. 인프라가 올라오면 두 코어 PoC를 Phase 1보다 먼저 실행한다.
3. PoC 결과를 기준으로 샌드박스 보안 옵션과 트리플 추출 프롬프트를 보정한다.
