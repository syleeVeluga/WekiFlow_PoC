# 03. 제안서 — OKF 기반 지식 표준·거버넌스 도입 (Proposal)

> 갭 분석([`02`](./02-gap-analysis.md))에서 드러난 **기준·SoT·정책·지속업데이트**의 빈틈을, OKF 모델을 차용해 메우는 구체 설계.
> WekiFlow의 강점(샌드박스 검증·사람 검토·Hybrid RAG)은 보존하고, 약점(표준·이식성·갱신)을 OKF로 보강한다.

---

## 1. 제안의 한 문장

> **지식의 진실의 원천(System of Record)을 MongoDB에서 git-backed OKF 호환 번들("WKF")로 역전시키고, 정책을 선언적 `policy.yaml`로 코드화하며, 스케줄 기반 큐레이션 파이프라인(C)으로 지속 갱신을 추가한다.**

---

## 2. 핵심 제안 ① — System of Record 역전 (★ 가장 중요)

### 2.1 현재 vs 제안

```
[현재]  진실의 원천 = MongoDB documents
        MD 본문·KG·벡터가 모두 DB에 갇힘 → 이식·diff·재현 불가

[제안]  진실의 원천 = git 저장소의 WKF 번들 (Markdown + YAML frontmatter)
        MongoDB(벡터·KG)는 번들에서 언제든 재빌드 가능한 "파생 인덱스"로 강등
```

### 2.2 데이터 흐름 (제안)

```
                    ┌──────────────────────────────────────────────┐
   진실의 원천 ───▶ │  git 저장소 : WKF 번들                          │
   (System of       │   /hr/annual-leave.md  (frontmatter + body)    │
    Record)         │   /hr/log.md           (변경 이력)             │
                    │   /index.md            (okf_version, 목록)     │
                    │   /policy.yaml         (정책)                  │
                    └───────────────┬───────────────▲────────────────┘
                          빌드/동기화 │               │ 커밋(승인 시)
                                     ▼               │
                    ┌──────────────────────────────────────────────┐
   파생 인덱스 ───▶ │  MongoDB : chunks(vector) · kg_nodes/edges     │
   (Derived,        │  ← 번들에서 결정론적으로 재빌드 가능            │
    rebuildable)    │  `wkf reindex` 한 번이면 완전 복구             │
                    └────────────────────────────────────────────────┘
```

### 2.3 왜 역전인가 (근거)

| 효과 | 설명 |
| :--- | :--- |
| **이식성** | 번들을 통째로 다른 조직·환경에 복사 → 즉시 동작. DB 덤프 의존 제거. |
| **감사성/재현성** | git history = 완전한 시간여행. "2026-03-01의 연차 규정"을 정확히 복원. |
| **신뢰** | 사람이 PR로 지식 변경을 리뷰(코드 리뷰처럼). Monaco Diff가 자연스럽게 git diff와 정합. |
| **재난 복구** | DB가 날아가도 `wkf reindex` 한 번으로 벡터·KG 완전 복구. |
| **PoC 비용 낮음** | 아직 PoC 단계라 마이그레이션할 운영 데이터가 거의 없음 — **지금이 역전의 최적 시점**. |

> **"현재 구조를 버려도 된다"의 실현:** 버리는 것은 *기능*이 아니라 **"DB가 진실"이라는 가정 하나**다. 기능(검증·검토·RAG)은 전부 유지된다.

### 2.4 비파괴적 대안 (Option B — 보수적)

역전이 부담스럽다면: **번들을 DB의 export 산출물로만** 추가한다.
- SoT는 MongoDB 유지, 승인 시 `documents` → WKF 파일로 export(+ git commit).
- 장점: 기존 코드 거의 무변경. 단점: export가 "사본"이라 SoT 이중화·동기화 위험, 재현성 이득 절반.

| | Option A (역전·권장) | Option B (export·보수) |
| :--- | :--- | :--- |
| SoT | git 번들 | MongoDB |
| 이식성/재현성 | ✅ 완전 | 🟠 부분 |
| 코드 변경량 | 중간(쓰기 경로 재배선) | 작음 |
| 동기화 위험 | 없음(단일 SoT) | 있음(이중 SoT) |
| PoC 적합성 | ✅ 지금이 적기 | 나중에 역전 시 재작업 |

> **권장: Option A.** PoC 단계라 전환 비용이 낮고, 나중에 역전하려면 더 비싸다.

### 2.5 그래프(KG)도 번들에 직렬화 — OKF 링크의 확장

> 검토 중 제기된 질문: *"OKF의 마크다운 링크로 그래프를 대체할 수 있나?"* → 평범한 OKF 링크는 **무타입·문서단위·무가중치**라 `tool_search_graph`의 타입드 멀티홉 추론을 대체하지 못한다. 대신 OKF 링크의 정신을 살려 **술어·방향·가중치를 담는 타입드 링크(`# Relations`)** 로 확장하고, 그래프를 번들에 직렬화한다. (스펙 상세: [`04` §4.1](./04-wekiflow-knowledge-spec.md))

```
[현재]  파이프라인 B → kg_nodes/kg_edges (MongoDB, SoT 일부)
[제안]  파이프라인 B → 개념 문서의 # Relations 섹션 (git 번들, SoT)
                         │ wkf reindex
                         ▼
                  kg_nodes/kg_edges (MongoDB, 파생 인덱스)
```

- 트리플이 git에 살아 **사람이 diff로 관계 변경을 리뷰**하고, DB가 날아가도 `wkf reindex`로 완전 복구.
- 멀티홉 추론(`$graphLookup`)·`tool_search_graph`는 **그대로 보존** — 질의는 여전히 DB에서.
- → SoT 역전이 **문서 본문뿐 아니라 그래프까지 일원화**한다.

---

## 3. 핵심 제안 ② — 정책의 형식화 (`policy.yaml`)

암묵적·산발적 정책을 **번들 루트의 선언적 `policy.yaml`** 한 곳으로 모으고, 파이프라인이 이를 *강제*한다. (구체 스키마는 [`04`](./04-wekiflow-knowledge-spec.md) §정책)

정책이 다룰 영역:

| 영역 | OKF 대응 | WekiFlow 강제 지점 |
| :--- | :--- | :--- |
| **소스 신뢰 등급** | domain allowlist | 인입·enrichment 시 소스 tier 검사 |
| **신선도 SLA** | `timestamp` | 파이프라인 C가 stale 개념 자동 재검증 |
| **인용 의무** | `# Citations` | `tool_verify_integrity`가 인용 누락 시 실패 |
| **자원 상한** | crawl 상한 | enrichment 워커 page/step 상한 |
| **검토 권한** | (운영) | `policy.yaml`의 type별 승인 등급 → RBAC |
| **적합성 게이트** | conformance MUST | 커밋 전 `wkf validate` 통과 필수 |

> **핵심:** "지키면 좋은 가이드"가 아니라 **"어기면 커밋/배포가 막히는 실행 계약"** 으로 만든다 — OKF의 가드레일 철학 그대로.

---

## 4. 핵심 제안 ③ — 지속 업데이트: 파이프라인 C 신설

기존 이벤트형 A(인입)/B(그래프)는 **유지**. 시간축 갱신을 담당할 **세 번째 톱니바퀴**를 추가한다.

```
[A] 인입 파이프라인 (이벤트)  ── 그대로 유지
[B] 그래프 파이프라인 (이벤트) ── 그대로 유지 (트리거를 "번들 커밋"으로 재배선)
[C] 큐레이션/재검증 파이프라인 (스케줄) ── ★ 신설
```

### 4.1 파이프라인 C 동작

```
[1] 스케줄 트리거 (예: 매일/매주 cron, BullMQ repeatable job)
        │
[2] 신선도 스캔 : policy.yaml의 type별 SLA 대비 timestamp 초과 개념 선별
        │   예) type=REGULATION, freshness=90d → 90일 지난 규정 문서 큐잉
        ▼
[3] 재검증/보강 (OKF 2-pass 차용)
        ├─ (사내) 샌드박스 grep으로 원문 재확인 → 변동 감지
        └─ (외부·정책 허용 시) allowlist 도메인 크롤 → enhance/create/skip 3중 판단
        │
[4] 변경 시 : tool_merge로 갱신 초안 생성 → 검토 게이트(A와 동일)
        │   변경 없음 : timestamp만 "재검증 완료"로 갱신 + log.md 기록
        ▼
[5] 승인 → 번들 커밋 → log.md에 **Update** 기록 → 재인덱싱
```

### 4.2 `log.md`로 개념 이력 도입

각 디렉터리(또는 개념)에 `log.md`를 두어, **사람이 읽는 변경 이력**을 남긴다. 현재의 `jobs.agentSteps`(기계 감사)와 **별도**로, "이 지식이 언제·왜·무엇이 바뀌었나"를 기록.

```markdown
## 2026-06-19
- **Update** 연차 규정 제4조: 신입 부여 연차 15일→16일 (출처: HR 공지 2026-06-15). 검토자 sylee.
## 2026-03-01
- **Creation** 연차 규정 최초 등록 (출처: 취업규칙 v3).
```

> A/B/C 모두 **승인 시 `log.md`에 자동 1줄 append**. 사람 검토자의 신뢰 판단 근거가 된다.

---

## 5. 통합 아키텍처 (제안 후 전체 그림)

```
┌─ Frontend (BlockNote ↔ Monaco Diff) ───────────────────────────┐
│  검토·승인 = git PR/커밋과 정합                                  │
└───────────────┬───────────────▲────────────────────────────────┘
        REST/SSE │               │ 승인(Commit) → git
                 ▼               │
┌─ API (Fastify) : 인증·RBAC·검토 워크플로 · wkf validate 게이트 ─┐
└──┬──────────────┬──────────────────────────┬───────────────────┘
   │ enqueue      │ enqueue                   │ schedule(cron)
   ▼              ▼                           ▼
[A] Main Worker  [B] Graph Worker        [C] Curation Worker ★신설
  인입→검색→병합   번들커밋→트리플추출       신선도스캔→재검증→보강
  →검증→커밋       →KG 재빌드               (policy.yaml SLA 구동)
   │              │                           │
   └──── 공통: 샌드박스 grep 검증 · log.md 기록 · tool_merge ──────┘
                 │
                 ▼
   ┌─ 진실의 원천 : git 저장소 (WKF 번들) ──────────────────┐
   │  *.md(frontmatter+body) · log.md · index.md · policy.yaml │
   └──────────────┬──────────────────────────────────────────┘
                  │ wkf reindex (결정론적 재빌드)
                  ▼
   ┌─ 파생 인덱스 : MongoDB (chunks/vector · kg_nodes/edges) ─┐
   └──────────────────────────────────────────────────────────┘
```

핵심 변화 3가지: **(1) SoT = git 번들**, **(2) policy.yaml 게이트**, **(3) 파이프라인 C**.

---

## 6. Keep / Discard / Add 결정표

| 처분 | 항목 |
| :--- | :--- |
| ✅ **Keep** | 샌드박스 grep 검증, `tool_verify_integrity`, Monaco Diff 사람 검토, RBAC 승인 게이트, Hybrid RAG(vector+graph+RRF), 듀얼 파이프라인 A/B, AI SDK `ToolLoopAgent` 루프, 샌드박스 보안 하드닝 |
| 🔻 **Discard/Demote** | "MongoDB=SoT" 가정(→git 번들로 역전), `contentMarkdown` 자유형식(→WKF 계약), `version` 정수(→git+log.md) |
| ➕ **Add** | WKF 스펙 + `wkf validate`, `policy.yaml`, 파이프라인 C(큐레이션), `log.md` 개념 이력, frontmatter(`type/resource/tags/timestamp`), `# Citations` 본문 인용, `# Relations` 타입드 링크(그래프 직렬화), `wkf reindex`(번들→벡터/KG 재빌드 CLI) |

---

## 7. 단계별 도입 로드맵 (기존 Phase 0~4와 정합)

> 기존 로드맵([`docs/12`](../12-roadmap-and-milestones.md))을 깨지 않고 **Phase 5~7로 증분 도입**. 각 단계는 독립적으로 가치를 주므로 중단해도 손실이 적다.

### Phase 5 — 표준 도입 (Standard first)
- [ ] **WKF v0.1 스펙 확정**([`04`](./04-wekiflow-knowledge-spec.md)) — frontmatter 계약, 예약 파일, 적합성 규칙.
- [ ] `packages/wkf` 신설: `validate`(적합성), `parse`(frontmatter), `serialize`(documents↔MD) 유틸.
- [ ] 기존 `documents`에 frontmatter 매핑 어댑터(`type/resource/tags/timestamp` 채우기).
- [ ] **DoD:** 임의의 PUBLISHED 문서가 `wkf validate`를 통과한다.

### Phase 6 — SoT 역전 (System of Record)
- [ ] git-backed 번들 디렉터리 레이아웃 + `wkf export`(DB→번들), `wkf reindex`(번들→DB).
- [ ] 승인 워크플로를 **번들 커밋**으로 재배선(파이프라인 B 트리거를 "커밋"으로 변경).
- [ ] **DoD:** DB를 비운 뒤 `wkf reindex`만으로 벡터·KG가 완전 복구된다(재현성 증명).

### Phase 7 — 정책 + 지속 업데이트 (Policy & Continuous Update)
- [ ] `policy.yaml` 스키마 + 로더 + 게이트(커밋 전 강제).
- [ ] **파이프라인 C(큐레이션 워커)** — BullMQ repeatable job, 신선도 스캔→재검증.
- [ ] `log.md` 자동 append(A/B/C 공통).
- [ ] (선택) 외부 enrichment: allowlist 크롤 + enhance/create/skip 판단.
- [ ] **DoD:** SLA 초과 개념이 자동 큐잉되어 재검증되고, 변경이 `log.md`에 남는다.

---

## 8. 리스크와 완화

| 리스크 | 완화 |
| :--- | :--- |
| SoT 역전 중 데이터 정합성 깨짐 | PoC 단계라 운영 데이터 적음. `wkf reindex` 멱등 보장 + 양방향(export/reindex) 라운드트립 테스트. |
| git 저장소 비대화(바이너리·이미지) | 에셋은 MinIO 유지, 번들은 MD+frontmatter만. 이미지 참조는 `resource`/링크로. |
| 외부 enrichment 폭주/오염 | OKF 가드레일 그대로: `policy.yaml`의 allowlist + page/step 상한 + 검토 게이트 필수. |
| 동시 편집 충돌(사람 vs 에이전트) | git 머지 + Monaco Diff 검토가 자연스러운 충돌 해소 지점. |
| frontmatter 표준이 과하게 경직 | OKF처럼 "엄격한 코어(type 필수) + 관대한 확장(임의 키 보존)". |

---

## 9. 결론 및 다음 행동

1. **결정 요청:** SoT 역전(Option A, 권장) vs export(Option B) — [`00-README.md`](./00-README.md) Open Questions 참조.
2. **결정 시:** [`04-wekiflow-knowledge-spec.md`](./04-wekiflow-knowledge-spec.md)의 WKF v0.1 초안을 확정 → Phase 5 착수.
3. **Gemini 대화 맥락**이 있으면 공유 — 정책 디폴트(신선도 SLA, 소스 범위)·요구사항을 본 제안에 정합시킨다.

> 이 제안은 WekiFlow를 *"검증에 강한 지식 생산 엔진"* 위에 *"표준·거버넌스·지속갱신"* 이라는 OKF의 골격을 얹는 것이다. 둘은 경쟁이 아니라 보완이다.
