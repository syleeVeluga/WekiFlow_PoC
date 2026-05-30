# 12. 로드맵 · 마일스톤 · 리스크 (Roadmap, Milestones & Risks)

> 전체 Phase의 의존 관계, 권장 순서, 리스크와 대응을 정리합니다.
> *Dependencies, recommended order, and risk mitigations across all phases.*

---

## 1. 의존 관계 그래프 (Dependency Graph)

```
Phase 0 (기반: 모노레포 + 인프라)
   │
   ├──────────────┐
   ▼              ▼
PoC ① 샌드박스   PoC ② LightRAG 추출      ← PRD 권고: 가장 먼저!
   │              │
   ▼              │
Phase 1 (에디터 UI + 메인 큐 골격)        ← PoC와 병행 가능
   │              │
   ▼              │
Phase 2 (파이프라인 A: 샌드박스+에이전트) │ (PoC① 재사용)
   │              │
   ▼              ▼
Phase 3 (파이프라인 B: 트리플 추출)        (PoC② 재사용)
   │
   ▼
Phase 4 (하이브리드 RAG 통합 — 선순환 완성)
```

핵심: **PoC ①·②는 Phase 0 직후 가장 먼저** 통과시킨다(PRD 강력 권고). 가장 큰 기술 리스크(샌드박스 격리, 트리플 추출 신뢰도)를 조기에 제거하기 위함.

---

## 2. 권장 순서 & 산출물 (Recommended Order & Deliverables)

| 순서 | 단계 | 핵심 산출물 | 게이트(DoD) |
| :--- | :--- | :--- | :--- |
| 1 | **Phase 0** | 모노레포, docker-compose, DB 인덱스, 샌드박스 이미지 | [06 문서 §4](./06-phase-0-foundation.md) |
| 2 | **PoC ①·②** | grep 실행 스크립트, LightRAG 추출 스크립트 | [11 문서 §A·§B](./11-testing-and-verification.md) |
| 3 | **Phase 1** | 투트랙 에디터 UI, Fastify API, 메인 큐(스텁 워커) | [07 문서 §4](./07-phase-1-editor-ui.md) |
| 4 | **Phase 2** | 실제 에이전트 루프, 샌드박스/검색/병합/검증 도구 | [08 문서 §7](./08-phase-2-sandbox-pipeline-a.md) |
| 5 | **Phase 3** | Graph Worker, 트리플 추출/적재, Resolution | [09 문서 §6](./09-phase-3-graph-pipeline-b.md) |
| 6 | **Phase 4** | `tool_search_graph`, 하이브리드 랭킹, 선순환 | [10 문서 §6](./10-phase-4-hybrid-rag.md) |

> 일정 수치는 팀 규모·AI 코딩 속도에 따라 달라지므로 의도적으로 명시하지 않음. 각 게이트 통과를 마일스톤으로 삼는다.

---

## 3. 리스크 & 대응 (Risks & Mitigations)

| 리스크 | 영향 | 대응 (Mitigation) |
| :--- | :--- | :--- |
| **샌드박스 보안**(Docker 소켓 = 루트급 권한) | 높음 | rootless Docker / 전용 격리 호스트, `CapDrop ALL`, `network=none`, read-only. 장기 gVisor/Kata 검토. ([05 문서](./05-sandbox-security.md)) |
| **`$vectorSearch` Atlas 의존** | 중 | Phase 0에서 Atlas vs 로컬 Atlas vs 앱-코사인 결정. `tool_search_vector` 추상화로 교체 용이. ([06 §3](./06-phase-0-foundation.md)) |
| **트리플 추출 품질**(한국어 동의어/대명사) | 중 | LightRAG 프롬프트 + 임베딩 기반 Entity Resolution, 정규화 사전. PoC②로 조기 검증. |
| **에이전트 루프 폭주/비용** | 중 | `stopWhen`(스텝 상한), 타임아웃, 토큰 사용량 로깅, 도구 호출 최소화 프롬프트. |
| **AI SDK 6 빠른 버전 변화** | 중 | 버전 핀 고정 + 분기별 마이그레이션 점검. `Agent` 공개 API에만 의존. |
| **그래프 append-only로 stale 관계** | 낮음 | `sourceDocIds` 추적, 추후 reconcile job. ([09 §4](./09-phase-3-graph-pipeline-b.md)) |
| **Monaco/React 19 호환** | 낮음 | `@monaco-editor/react@4.7`(필요 시 `@next`), lazy import. |
| **큐 잡 유실(Redis 이빅션)** | 낮음 | `maxmemory-policy noeviction`, attempts/backoff, `jobs` 감사 로그. |

---

## 4. 전역 비기능 요구 (Cross-cutting NFRs)

- **관측성**: pino 구조화 로그, `jobs.agentSteps`/`sandbox_runs` 감사, 도구 메트릭.
- **보안**: 최소 권한(워커별 도구 노출 분리), 비밀 미주입(샌드박스), RBAC 승인 게이트.
- **멱등성**: 큐 잡·트리플 upsert 모두 멱등.
- **비용 통제**: 임베딩/LLM 토큰 사용량 잡 단위 기록 및 상한.
- **재현성**: Node 24 핀, 버전 핀, `docker compose`로 동일 로컬 환경.

---

## 5. 다음 액션 (Immediate Next Actions)

1. [`06-phase-0-foundation.md`](./06-phase-0-foundation.md)로 모노레포 + `docker compose up -d`.
2. `docker build -t wekiflow/sandbox docker/sandbox` 후 [PoC ①](./11-testing-and-verification.md) 실행.
3. [PoC ②](./11-testing-and-verification.md) 실행으로 트리플 추출 신뢰도 확인.
4. 두 PoC 통과 시 Phase 1 착수.

> 본 문서 묶음은 AI 페어 프로그래밍에 바로 투입 가능하도록 파일/함수/명령 단위까지 기술되어 있다. 각 Phase 문서를 작업 단위 프롬프트의 컨텍스트로 사용할 것.

---

## 부록 — 검증된 버전 요약 (Verified Versions, 2026-05)

| 영역 | 패키지/런타임 | 버전 |
| :--- | :--- | :--- |
| 런타임 | Node.js | 24 LTS |
| 빌드 | Vite | 8.0.x |
| UI | React | 19 |
| 에디터 | @blocknote/react · @blocknote/core | 0.50.x |
| 에디터 | @monaco-editor/react | 4.7.x |
| 에이전트 | ai (Vercel AI SDK) | 6.0.x |
| 큐 | bullmq | 5.77.x |
| DB | mongodb (Node Driver) | 6.18.x |
| 샌드박스 | dockerode | 5.0.x |
| 저장소 | minio (minio-js) | 8.x (설치 시 재확인) |
| 방법론 | LightRAG | EMNLP 2025 |

> 설치 직전 `npm view <pkg> version`으로 패치 버전 재확인. 출처는 [`02-tech-stack.md`](./02-tech-stack.md)와 본 계획 수립 시 검색 결과 참조.
