# 10. 통합 실행 계획서 (Consolidated Execution Plan)

> 사용자 확정(2026-06-19): **진실의 원천 역전(Option A)·데이터 흐름·제안 전반·큐레이션 재검증 수용**.
> 문서 01~09에 흩어진 채용 항목을 **3개 Phase로 합쳐** 실제 구현 계획으로 정리한다. 기존 로드맵([`docs/12`](../12-roadmap-and-milestones.md))의 Phase 0~4에 이어진다.

---

## 0. 확정된 결정 (Locked Decisions)

| # | 결정 | 상태 | 근거 |
| :--- | :--- | :--- | :--- |
| 1 | **System of Record = git-backed WKF 번들** (MongoDB는 파생 인덱스로 강등) | ✅ **확정** | [`03` §2](./03-proposal.md) |
| 2 | **데이터 흐름**: 번들(SoT) → `wkf reindex` → 벡터/KG | ✅ **확정** | [`03` §2.2] |
| 3 | **그래프 직렬화**: 파이프라인 B 출력을 `# Relations` 섹션으로 (KG는 재빌드) | ✅ **확정** | [`04` §4.1](./04-wekiflow-knowledge-spec.md) |
| 4 | **큐레이션 재검증(파이프라인 C)** 도입 | ✅ **확정** | [`05`](./05-curation-agent.md) |
| 5 | **동기화 = 낙관적 락**(push는 마지막 pull 이후 변경분만 & 그 사이 원본 미변경 시) | ✅ **확정**(제안 수용) | [`09` §B.2](./09-enrichment-harness-and-mdcode.md) |
| 6 | **재작성 가드레일 = 비축소(non-shrinkage) 자동 테스트** | ✅ **확정**(제안 수용) | [`07` §5](./07-knowledge-format-and-generation.md) |
| 7 | enrichment 외부 소스 범위 | 🟡 **기본값 채택**: 1차는 **사내 grep 재검증만**, 외부 allowlist 크롤은 Phase 7 opt-in | 변경 가능 |
| 8 | 신선도 SLA 기본값 | 🟡 **기본값 채택**: REGULATION 90d · POLICY 180d · METRIC 30d · default 365d | 변경 가능 |

> 7·8은 명시 지정이 없어 안전한 기본값으로 출발한다. 한 줄로 바꾸면 되는 정책 값이므로 언제든 조정.

---

## 1. Phase 합침 결과 (5~8 → 3 Phase)

원래 흩어졌던 슬롯을 의존성 기준으로 3개로 합쳤다:

| 합친 Phase | 흡수한 기존 슬롯 | 핵심 |
| :--- | :--- | :--- |
| **Phase 5 — 표준 + SoT 역전** | 구 Phase 5(표준) + 구 Phase 6(SoT) | 표준 정의와 진실의 원천 이전은 한 묶음 |
| **Phase 6 — 정책 + 큐레이션 재검증** | 구 Phase 7(정책·지속업데이트) | `policy.yaml` + 파이프라인 C + 가드레일 |
| **Phase 7 — 피드백 학습 + 검색 강화** | 구 Phase 8(러너) + Phase 4 확장(discovery) | 선순환 완성 |

```
Phase 0~4 (기존: 인프라·UI·샌드박스 A·그래프 B·하이브리드 RAG)
        │
        ▼
Phase 5  표준(WKF) 정의  +  SoT 역전(번들=진실, DB=파생)      ← 토대
        │
        ▼
Phase 6  정책(policy.yaml)  +  큐레이션 재검증(파이프라인 C)   ← 지속 갱신
        │
        ▼
Phase 7  피드백 학습(러너)  +  검색 강화(discovery)           ← 선순환
```

---

## 2. Phase 5 — 지식 표준 + SoT 역전 (Standard & System-of-Record)

> **목표:** 지식을 WKF 표준 문서로 정의하고, 진실의 원천을 git 번들로 역전. MongoDB는 `wkf reindex`로 완전 재빌드 가능한 파생 인덱스가 된다.

### 2.1 작업 (Work Items)

| # | 작업 | 산출물 | 근거 |
| :--- | :--- | :--- | :--- |
| 5-1 | **WKF v0.1 스펙 확정** (frontmatter 계약, 예약파일, 적합성 MUST) | `packages/wkf/SPEC.md` | [`04`](./04-wekiflow-knowledge-spec.md) |
| 5-2 | `packages/wkf` 코어: `parse`/`serialize`/`validate`/`fromMongo` | 라이브러리 | [`04` §8] |
| 5-3 | 개념 문서 표준 템플릿 적용(`# Facts`/`# Schema`/`# Examples`/`# Relations`/`# Citations`) | 템플릿 + 마이그레이션 어댑터 | [`07` §1](./07-knowledge-format-and-generation.md) |
| 5-4 | git 번들 레이아웃 + `wkf init/status/pull/push/reference` (**낙관적 락**) | `wkf` CLI | [`09` §B](./09-enrichment-harness-and-mdcode.md) |
| 5-5 | `wkf reindex`(번들→chunks/벡터 + `# Relations`→kg_*) 멱등 | 재빌드 파이프라인 | [`04` §4.1], [`03` §2.2] |
| 5-6 | 파이프라인 B 출력 재배선: DB 직접쓰기 → `# Relations` 섹션 생성 | 워커 변경 | [`04` §4.1] |
| 5-7 | `index.md` 자동 생성(트리 네비) | `wkf index` | [`07` §4] |
| 5-8 | **적합성 테스트**: roundtrip(parse↔serialize) + 필수필드 + 모르는키 보존 | `vitest` 스위트 | [`07` §5] |

### 2.2 완료 기준 (DoD)
- [ ] 임의의 PUBLISHED 문서가 `wkf validate`를 통과한다.
- [ ] **DB를 비운 뒤 `wkf reindex`만으로 벡터·KG가 완전 복구**된다(재현성 증명).
- [ ] 사람(Monaco)·에이전트(A) 동시 수정 시 낙관적 락이 클로버를 차단한다.
- [ ] `parse→serialize` 라운드트립이 frontmatter+본문을 보존한다(테스트 green).

### 2.3 의존성/리스크
- 선행: Phase 2(파이프라인 A)·3(파이프라인 B) 동작.
- 리스크: 역전 중 정합성 → PoC라 운영데이터 적음 + 라운드트립 테스트로 방어.

---

## 3. Phase 6 — 정책 + 큐레이션 재검증 (Policy & Continuous Curation)

> **목표:** 거버넌스를 `policy.yaml`로 선언·강제하고, 신선도 SLA가 지난 지식을 자동 재검증하는 파이프라인 C를 가동. 재작성은 가산·비축소만 허용.

### 3.1 작업

| # | 작업 | 산출물 | 근거 |
| :--- | :--- | :--- | :--- |
| 6-1 | `policy.yaml` 스키마 + 로더 + **커밋 전 게이트** | 정책 엔진 | [`04` §5] |
| 6-2 | 신선도 SLA(결정 #8) · 소스 tier · 인용 의무 · allowlist · 자원 상한 강제 | 게이트 통합 | [`04` §5], [`03` §3] |
| 6-3 | **파이프라인 C(큐레이션 워커)**: BullMQ repeatable(cron) + `scanStale` | `workers/curation` | [`05` §4](./05-curation-agent.md) |
| 6-4 | 큐레이션 `ToolLoopAgent`: grep 재검증 → enhance/create/skip(의심시 skip) | 에이전트 | [`05` §4.3] |
| 6-5 | **reference 베이스라인 그라운딩**(읽기전용 현재본 주입) | `wkf reference` 연동 | [`06` §2](./06-adoptable-patterns.md), [`09` §A] |
| 6-6 | **비축소 가드레일을 쓰기 직전 강제**(헤딩/스키마/인용 비감소) | `assertNoShrinkage` | [`07` §5] |
| 6-7 | `log.md` 자동 append(A/B/C: **Creation/Update/Verify**) | 이력 | [`04` §6], [`05` §4.2] |
| 6-8 | "변경 없음"도 1급 결과: `last_verified`만 갱신 | C 분기 | [`05` §4.2] |
| 6-9 | (선택) `recipe.yaml` 재현 생성 + `wkf regenerate` | 재생성 | [`07` §3] |

### 3.2 완료 기준 (DoD)
- [ ] SLA 초과 개념이 자동 큐잉되어 재검증되고, 변경이 `log.md`에 남는다.
- [ ] 큐레이션 에이전트가 헤딩/스키마/인용을 줄이는 커밋은 **테스트에서 자동 차단**된다.
- [ ] 원문 미변동 개념은 재작성 없이 `last_verified`만 갱신된다.
- [ ] `policy.yaml` 위반(인용 누락 등) 시 커밋이 막힌다.

### 3.3 범위 메모(결정 #7)
1차는 **사내 grep 재검증만**. 외부 allowlist 크롤(`fetch_url` + `web_max_pages`)은 Phase 7에서 opt-in.

---

## 4. Phase 7 — 피드백 학습 + 검색 강화 (Feedback Learner & Discovery)

> **목표:** 실사용 실패에서 역으로 배우는 러너와, 질문 분해형 검색을 더해 PRD의 "선순환"을 질의측까지 확장.

### 4.1 작업

| # | 작업 | 산출물 | 근거 |
| :--- | :--- | :--- | :--- |
| 7-1 | **Feedback Learner(파이프라인 D)**: `jobs.agentSteps` judge → `WkfEnrichmentProposal[]` | `workers/learner` | [`08` §A](./08-agent-implementation-specs.md) |
| 7-2 | 제안 → 검토 큐 / 파이프라인 C 우선순위 입력 | 연결 | [`08` §A.4] |
| 7-3 | `evalCandidate` → **회귀 골든셋** 적재(검색 품질 회귀 감지) | 골든셋 | [`08` §A.1] |
| 7-4 | **Discovery**: 질문분해 + baseline+3변형 다중쿼리 + dedup + 리랭크 | 검색 전처리 | [`08` §B] |
| 7-5 | end-user Q&A 에이전트 + **`AgentTool` 합성**(멀티에이전트 1단계) | `discoveryAgent` | [`08` §B.4] |
| 7-6 | (선택) 외부 enrichment: allowlist 크롤 + enhance/create/skip(결정 #7) | C 확장 | [`05` §4], [`09` §A.2] |
| 7-7 | (선택) **MCP 서버**(`wkf mcp`)로 번들 노출 + 멀티소스 커넥터 | 생태계 | [`09` §B.4], [`06` §5] |

### 4.2 완료 기준 (DoD)
- [ ] 실패 궤적(verify 실패/그래프 빈 경로/벡터 저점수)에서 `WkfEnrichmentProposal`이 생성되어 검토 큐로 들어간다.
- [ ] 복합 질문("영업팀 신입 출장 범위?")의 검색 재현율이 분해+멀티쿼리로 향상된다.
- [ ] Discovery가 인입 에이전트의 `AgentTool`로도 호출된다.

### 4.3 선순환 (완성형)
```
Discovery(질의) → 궤적(agentSteps) → Learner(격차탐지) → 검토 → Curation C(보강·비축소)
   ▲                                                                    │
   └──────────────── wkf reindex (번들→벡터/KG) ◀── 번들 커밋 ──────────┘
```

---

## 5. 전체 타임라인 & 게이트

| Phase | 핵심 산출물 | 게이트(통과 조건) |
| :--- | :--- | :--- |
| **5** | `packages/wkf`, `wkf` CLI, 번들=SoT, reindex | DB 비우고 reindex로 완전복구 |
| **6** | `policy.yaml`, 파이프라인 C, 비축소 테스트, log.md | SLA 초과→자동 재검증→이력 기록 |
| **7** | 러너(파이프라인 D), Discovery, 회귀 골든셋 | 실패 궤적→제안→검토 / 재현율↑ |

각 Phase의 작업표 `#`를 이슈/PR 단위로 쓰면 그대로 백로그가 된다.

---

## 6. 신규/변경 패키지·워커 요약

| 경로 | 신규/변경 | 역할 |
| :--- | :--- | :--- |
| `packages/wkf` | 🆕 | 스펙·parse/serialize/validate·sync(낙관적 락)·reindex·index |
| `workers/graph` | 🔧 변경 | 트리플 출력 → `# Relations` 섹션(DB 직접쓰기 폐지) |
| `workers/curation` | 🆕 | 파이프라인 C(신선도 재검증·가드레일·log.md) |
| `workers/learner` | 🆕 | 파이프라인 D(궤적 judge → 제안) |
| `apps/api` | 🔧 변경 | `wkf validate`/`policy` 게이트, Discovery 라우트, 검토=커밋 정합 |
| `apps/web` | 🔧 변경 | 대화형 보정(Monaco), 문서트리=index.md, end-user 검색 UI |
| `packages/agent-tools` | 🔧 변경 | Discovery 분해·러너 스키마·reference 그라운딩 |

---

> **PR 단위 상세 계획:** 본 계획의 각 작업을 PR로 전개한 문서가 [`implementation/`](./implementation/00-INDEX.md)에 있다(PR-01~PR-20 + 의존성 그래프). 착수는 그 인덱스를 따른다.

## 7. 다음 행동 (Immediate Next Steps)

1. **[PR-01](./implementation/PR-01-wkf-scaffold-and-spec.md) 착수**: `packages/wkf` 스캐폴딩 + WKF v0.1 스펙을 [`04`](./04-wekiflow-knowledge-spec.md) 기준으로 코드화.
2. 결정 #7·#8 기본값을 확정 또는 조정(한 줄 변경).
3. (선택) Gemini 대화 맥락 공유 시 정책 기본값·요구사항 재정합.

> 이 문서가 docs/24 시리즈의 **실행 기준점**이다. 01~09는 분석·설계 근거, 10은 무엇을 어떤 순서로 만들지의 단일 출처(single source of truth).
