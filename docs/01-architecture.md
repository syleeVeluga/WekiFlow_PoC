# 01. 시스템 아키텍처 (System Architecture)

> 듀얼 에이전트 파이프라인(The Hybrid Loop)을 중심으로 한 전체 구조.
> *Overall structure centered on the dual-agent pipeline.*

---

## 1. 아키텍처 개요 (Overview)

WekiFlow는 **두 개의 맞물리는 톱니바퀴**로 동작합니다.

- **파이프라인 A (Main Worker)** — 지식 인입 → 하이브리드 검색 → 병합 → 자가 검증 → 사람 검토.
- **파이프라인 B (Graph Worker)** — 문서 승인(Commit) 즉시 백그라운드에서 트리플(Entity-Relation-Entity) 추출 → MongoDB 지식망 적재.

A가 만든 검토 대상 문서가 승인되면 B가 가동되고, B가 쌓은 지식망은 다음 A 실행의 `tool_search_graph` 소스가 되어 **선순환(virtuous cycle)** 을 형성합니다.

```
                          ┌──────────────────────────────────────────────┐
                          │                  Frontend (SPA)               │
                          │  Vite + React 19 + TS                          │
                          │  ┌────────────┐        ┌──────────────────┐    │
                          │  │ BlockNote  │  토글  │ Monaco Diff      │    │
                          │  │ (열람/편집) │ <----> │ (정밀 검토/Diff) │    │
                          │  └────────────┘        └──────────────────┘    │
                          └───────────────┬───────────────▲────────────────┘
                                  REST/SSE │               │ 검토·승인(Commit)
                                          ▼               │
                          ┌──────────────────────────────────────────────┐
                          │        API Server (Fastify + TS, Node 24)      │
                          │  - 인증/권한, 문서 트리, 검토 큐 API           │
                          │  - SSE 스트리밍(에이전트 진행 상황)            │
                          └───────┬───────────────────────────┬───────────┘
                                  │ enqueue(Main Queue)        │ enqueue(Graph Queue)
                                  ▼                            ▼
        ┌────────────────────────────────────┐   ┌────────────────────────────────────┐
        │  파이프라인 A: Main Worker          │   │  파이프라인 B: Graph Worker          │
        │  (BullMQ Worker, Node 24)           │   │  (BullMQ Worker, Node 24)            │
        │  ┌────────────────────────────────┐ │   │  ┌────────────────────────────────┐ │
        │  │ Vercel AI SDK 6 (Agent loop)   │ │   │  │ Vercel AI SDK 6 (extract loop) │ │
        │  │  ├ tool_search_vector          │ │   │  │  └ tool_extract_triplets       │ │
        │  │  ├ tool_search_graph  ◀────────┼─┼───┼──┤    (LightRAG 방법론)           │ │
        │  │  ├ tool_execute_sandbox_term.  │ │   │  └────────────────────────────────┘ │
        │  │  ├ tool_merge                  │ │   │            │ upsert triplets         │
        │  │  └ tool_verify_integrity       │ │   │            ▼                         │
        │  └───────┬──────────────┬─────────┘ │   │   kg_nodes / kg_edges (MongoDB)      │
        └──────────┼──────────────┼───────────┘   └────────────────────────────────────┘
                   │              │
        exec bash/python          │ vector/graph 쿼리
                   ▼              ▼
   ┌───────────────────────┐  ┌──────────────────────────────────────────────────────┐
   │  격리 Docker 샌드박스  │  │                     MongoDB                          │
   │  (ephemeral, dockerode)│  │  documents · chunks(+vector) · kg_nodes · kg_edges   │
   │  - grep/awk/python     │  │  · jobs · users   (+ Atlas Vector Search index)      │
   │  - MinIO 볼륨 마운트   │  └──────────────────────────────────────────────────────┘
   └───────────┬───────────┘
               │ mount (read-only docs)
               ▼
   ┌───────────────────────┐        ┌───────────────────────┐
   │   MinIO (S3 호환)      │        │   Redis (BullMQ 백본)  │
   │   원본/MD/이미지 에셋  │        │   Main Queue/Graph Q   │
   └───────────────────────┘        └───────────────────────┘
```

---

## 2. 컴포넌트 책임 (Component Responsibilities)

| 컴포넌트 | 책임 (Responsibility) | 기술 |
| :--- | :--- | :--- |
| **Web (Frontend)** | 문서 트리 탐색, BlockNote 열람/편집, Monaco Diff 검토·승인, 에이전트 진행 SSE 표시 | Vite 8, React 19, BlockNote, @monaco-editor/react |
| **API Server** | REST/SSE, 인증·권한(RBAC), 문서 트리 CRUD, 잡 enqueue, 검토(Review) 워크플로 | Fastify, Zod, BullMQ(producer) |
| **Main Worker (A)** | 인입 정보 처리: 하이브리드 검색 → 병합 → 자가 검증. 에이전트 루프 오케스트레이션 | BullMQ Worker, AI SDK 6 |
| **Graph Worker (B)** | 승인된 MD에서 트리플 추출 → 엔티티 정규화(Resolution) → MongoDB 적재 | BullMQ Worker, AI SDK 6 |
| **Sandbox Runner** | 일회성 Docker 컨테이너 생성/실행/파기, bash·python 실행, 결과 캡처 | dockerode |
| **Datastore** | 문서·청크·벡터·트리플·잡·사용자 영속화 | MongoDB(+Vector Search) |
| **Object Storage** | 원본 파일/마크다운/이미지, 샌드박스 마운트 소스 | MinIO |
| **Broker** | 큐 백본, 잡 상태/재시도/동시성 제어 | Redis |

---

## 3. 파이프라인 A — Main Worker (작성/병합/검증)

```
[1] 지식 인입(텍스트/파일/데이터소스)  ──▶  BullMQ [Main Queue] 적재
        │
[2] 하이브리드 다차원 검색 (에이전트 도구 자율 선택)
        ├─ tool_search_vector  : 의미론적 유사 청크 탐색 ($vectorSearch)
        ├─ tool_search_graph   : 지식망 멀티홉 추론 (kg_edges $graphLookup)
        └─ tool_execute_sandbox_terminal : grep/awk/python으로 100% 확정 팩트 탐색
        │
[3] 병합 및 자가 검증
        ├─ tool_merge            : 수집 팩트 기반 문서 병합(초안 생성)
        └─ tool_verify_integrity : 인용 근거·수치·규정번호 무결성 검증
        │
[4] 리뷰 및 배포
        └─ 상태='검토'로 전환 ──▶ 관리자 Monaco Diff 검수 ──▶ ✅승인(Commit)
```

**핵심 설계 원칙:** Vector 검색의 한계(누락·근사치)를 **샌드박스 터미널의 결정론적 탐색(grep)** 으로 보강하여 **할루시네이션을 원천 차단**한다. 에이전트가 "확신이 안 서면 직접 파일을 열어 읽는다"는 Goose-스타일 능동성을 갖는다.

---

## 4. 파이프라인 B — Graph Worker (Post-Process)

```
[1] 트리거: 문서가 ✅승인됨  ──▶  BullMQ [Graph Queue] 적재
        │
[2] 트리플 추출 (LightRAG / SimGRAG 방법론)
        └─ tool_extract_triplets : MD 텍스트 → (Subject)-[Predicate]->(Object) JSON 배열
            · 모호한 대명사는 문맥상 원본 명사로 치환(coreference resolution)
            · 각 트리플에 strength score(관계 중요도) 부여
        │
[3] 분류 및 Graph DB 적재
        └─ Entity Resolution: 동일 엔티티 병합(정규화 키=정규화된 엔티티명)
            · 동일 관계는 description만 append
        │
[4] 메인 에이전트에 환원(선순환)
        └─ 구축된 지식망이 다음 [파이프라인 A]의 tool_search_graph 소스가 됨
```

---

## 5. 상태 머신 (Document State Machine)

UI/UX 매핑(PRD §4)을 상태로 정식화합니다.

```
 (없음)
   │  인입(데이터소스/직접추가)  →  Main Queue
   ▼
[PROCESSING]  ── 파이프라인 A 실행(검색·병합·검증) ──┐
   │                                                  │ 실패/오류
   ▼                                                  ▼
[REVIEW] 🔴 검토  ── 관리자 Monaco Diff 검수 ──┐   [FAILED]
   │ ✅승인(Commit)                              │ ✗반려
   ▼                                             ▼
[PUBLISHED] 🔷 조직 지식  ── Graph Queue 트리거 ──▶ [GRAPH_INDEXED]
```

- 🔴 **검토(REVIEW)**: 파이프라인 A의 병합·자가검증 완료 상태. Monaco Diff로 Human-in-the-loop.
- 🔷 **조직 지식(PUBLISHED)**: 공식 배포 문서. BlockNote 렌더링. 진입 즉시 파이프라인 B 트리거.
- 🔗 **데이터 소스 / ✏️ 직접 추가**: 파이프라인 A(Main Queue) 트리거 시작점.
- 📁 **문서 트리**: 인접 리스트(adjacency list) 기반 무한 뎁스 폴더. 에이전트가 자동 분류.

---

## 6. 데이터 흐름 요약 (Data Flow Summary)

1. 사용자가 정보 인입 → API가 `documents`에 draft 생성 + Main Queue에 잡 enqueue.
2. Main Worker가 에이전트 루프 실행, 필요 시 샌드박스에서 MinIO 마운트 문서를 grep.
3. 병합 결과를 `documents`(status=REVIEW)에 저장, SSE로 프론트에 진행 상황 push.
4. 관리자가 Monaco Diff로 검수 후 승인 → status=PUBLISHED + Graph Queue enqueue.
5. Graph Worker가 트리플 추출 → `kg_nodes`/`kg_edges` upsert.
6. 다음 인입 시 A의 `tool_search_graph`가 이 그래프를 멀티홉 탐색.

자세한 스키마는 [`03-data-model.md`](./03-data-model.md), 도구 시그니처는 [`04-agent-tools.md`](./04-agent-tools.md) 참조.
