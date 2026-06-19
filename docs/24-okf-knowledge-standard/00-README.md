# 24. OKF 기반 지식 표준·거버넌스 도입 검토 (Knowledge Standard & Governance)

> **무엇을 검토했나** — Google Cloud의 [`knowledge-catalog`](https://github.com/GoogleCloudPlatform/knowledge-catalog) 저장소, 특히 **OKF(Open Knowledge Format)** 가 지식을 어떻게 *표준화(기준)* 하고, *거버넌스(정책)* 하며, *지속적으로 갱신(continuous update)* 하는지를 심층 분석했다.
> **왜 검토했나** — 사용자 요청: "정책과 기준 그리고 지속 업데이트하는 부분이 우리 프로젝트에 필요하다. 현재 구조나 기능을 버려도 된다."
> *A deep review of OKF's policy / standard / continuous-update model and a proposal to adopt it into WekiFlow — even if that means replacing parts of the current architecture.*

---

## ⚠️ 검토 자료 접근에 대한 고지

| 자료 | 상태 |
| :--- | :--- |
| `github.com/GoogleCloudPlatform/knowledge-catalog` (OKF SPEC, enrichment agent, README) | ✅ 접근·분석 완료 |
| Gemini 대화 링크 (`gemini.google.com/app/90893df5ac530398`) | ❌ **접근 불가** — 로그인된 개인 세션이라 외부에서 열람 불가. 로그인 페이지만 반환됨. |

> Gemini 대화에 담긴 추가 맥락(요구사항·결정사항)이 있다면 **본문 텍스트를 붙여넣어** 주시면 본 분석에 반영해 재작업하겠다. 현재 제안서는 **knowledge-catalog 저장소 + 현 WekiFlow `docs/`** 만을 근거로 작성되었다.

---

## 📂 문서 구성 (Document Map)

| # | 파일 | 내용 |
| :--- | :--- | :--- |
| 00 | [`00-README.md`](./00-README.md) | (현재 문서) 요약·결론·읽는 순서 |
| 01 | [`01-reference-analysis.md`](./01-reference-analysis.md) | **knowledge-catalog / OKF 심층 분석** — 정책·기준·지속업데이트의 3축으로 해부 |
| 02 | [`02-gap-analysis.md`](./02-gap-analysis.md) | **갭 분석** — 현재 WekiFlow vs OKF 모델, 무엇이 없고 무엇을 버려야 하나 |
| 03 | [`03-proposal.md`](./03-proposal.md) | **제안서** — 권장 아키텍처(SoT 역전), Keep/Discard 결정, 단계별 도입 로드맵 |
| 04 | [`04-wekiflow-knowledge-spec.md`](./04-wekiflow-knowledge-spec.md) | **WKF v0.1 초안** — WekiFlow용 지식 포맷 스펙, frontmatter·`# Relations`·`log.md`·`policy.yaml` 구체 설계 |
| 05 | [`05-curation-agent.md`](./05-curation-agent.md) | **큐레이션 에이전트(파이프라인 C)** — 주기적 순회·재검증·갱신. `enrichment_agent` 분석 + 재작성 가드레일 + 우리 스택 이식 설계 |
| 06 | [`06-adoptable-patterns.md`](./06-adoptable-patterns.md) | **채용 가능 패턴 카탈로그** — `agents/`·`toolbox/`·`samples/` 정밀 검토. mdcode 동기화(낙관적 락)·reference 그라운딩·conversation_learner(피드백 갱신)·discovery(질의 검색)·MCP. 우선순위+Phase 매핑 |
| 07 | [`07-knowledge-format-and-generation.md`](./07-knowledge-format-and-generation.md) | **포맷 템플릿·재현 생성·적합성 테스트** — 실제 OKF 번들 기반 WKF 문서 템플릿, `references/` 1급 출처, recipe(재현 가능 생성), `index.md` 자동생성, **비축소(non-shrinkage) 적합성 테스트로 재작성 가드레일을 CI 강제** |
| 08 | [`08-agent-implementation-specs.md`](./08-agent-implementation-specs.md) | **에이전트 구현 스펙(TS)** — Feedback Learner(`ContextEnrichmentProposal`→WKF 적응, `jobs.agentSteps` 재사용) + Discovery(질문분해·다중쿼리·AgentTool 합성). 선순환 결합 |
| 09 | [`09-enrichment-harness-and-mdcode.md`](./09-enrichment-harness-and-mdcode.md) | **하니스 & 동기화 구현 스펙** — produce/evolve/maintain 운영모델, 멀티소스 커넥터, `catalog.yaml` 매니페스트, **낙관적 락 동기화 프로토콜**(`wkf` CLI), MCP 노출 |
| **10** | [`10-consolidated-execution-plan.md`](./10-consolidated-execution-plan.md) | ⭐ **통합 실행 계획서** — 확정 결정 + Phase 5~8을 3개로 합친 단일 실행 기준점(작업표·DoD·신규 패키지). **여기서 시작** |

읽는 순서: (실행) **10** → (근거) 01~09. 의사결정·착수만 보려면 **10번**과 아래 TL;DR을 본다.

---

## 🎯 TL;DR — 핵심 결론

### 1. OKF가 우리에게 주는 것 (한 문장)
> "지식을 **DB 안의 휘발성 레코드**가 아니라, **git으로 버전관리되는 이식 가능한 plain-text 표준 문서(Markdown + YAML frontmatter)** 로 다루고, **conformance 스펙**·**provenance 로그**·**enrichment 에이전트**로 정책·기준·지속갱신을 *형식화*한다."

### 2. 현재 WekiFlow와의 결정적 차이

| 축 | OKF | 현재 WekiFlow |
| :--- | :--- | :--- |
| **기준(Standard)** | 버전드 스펙(SPEC.md v0.1), 필수/권장 frontmatter, 적합성 규칙 | 형식 표준 없음. 지식은 임의 MD + MongoDB 스키마 |
| **System of Record** | **git-backed 마크다운 번들**(이식·diff·재현 가능) | **MongoDB**(이식·diff·재현 불가, 락인) |
| **정책(Policy)** | 선언적: 소스 allowlist, 크롤 상한, 적합성 게이트, 출처 의무 | 암묵적: RBAC + 사람 검토 게이트뿐. 신선도·소스신뢰 정책 없음 |
| **지속 업데이트** | **2-pass enrichment + 스케줄 재방문**, 신선도(timestamp) 기반 | **이벤트 푸시 only**(인입 시에만). 재검증·재크롤·staleness 없음 |
| **변경 이력** | 개념별 `log.md`(사람·에이전트 공용) | `jobs.agentSteps`(기계 감사용, 사람이 읽는 개념 이력 아님) |

### 3. 권장 방향 (제안서 03 상세)

- **★ 핵심 제안 — System of Record 역전:** 진실의 원천을 **MongoDB → git-backed OKF 호환 번들("WKF")** 로 옮긴다. MongoDB의 벡터·KG는 **번들에서 언제든 재빌드 가능한 파생 인덱스**로 강등한다. → 이식성·감사성·재현성 확보, "현재 구조를 버려도 된다"는 요구에 부합.
- **★ 정책의 형식화:** `policy.yaml` 도입 — 소스 신뢰 등급, 지식 유형별 신선도 SLA, 인용 의무, 적합성(conformance) 게이트, 검토 권한을 *선언적*으로 기술하고 파이프라인이 이를 강제.
- **★ 지속 업데이트(파이프라인 C 신설):** 기존 이벤트형 A(인입)/B(그래프)는 유지하되, **스케줄 기반 큐레이션/재검증 워커**를 추가. 신선도 SLA가 지난 개념을 자동으로 재검증·재크롤(소스 allowlist 내)하고 `log.md`에 기록.
- **Keep:** 샌드박스 grep 팩트체크, 사람 검토 게이트, 듀얼 파이프라인, AI SDK 도구 루프 — 모두 OKF와 직교하며 오히려 강점. **Discard/강등:** "MongoDB = 진실의 원천" 가정.

> 비파괴적 대안(번들을 **export 산출물**로만 추가하고 DB는 SoT 유지)도 03번에 함께 제시한다. 두 경로의 트레이드오프를 보고 결정하면 된다.

---

## 결정 현황 (Decisions — 2026-06-19 확정)

| 결정 | 상태 |
| :--- | :--- |
| **SoT 역전(Option A)** — 진실의 원천을 git 번들로 | ✅ **수용** |
| **데이터 흐름** — 번들 → `wkf reindex` → 벡터/KG | ✅ **수용** |
| **제안 전반** (낙관적 락·비축소 테스트 포함) | ✅ **수용** |
| **큐레이션 재검증(파이프라인 C)** | ✅ **수용** |
| 외부 enrichment 범위 | 🟡 기본값: 1차 **사내 grep만**, 외부 크롤은 Phase 7 opt-in (변경 가능) |
| 신선도 SLA 기본값 | 🟡 기본값: 규정 90d·정책 180d·지표 30d·기본 365d (변경 가능) |

→ 확정 사항을 반영한 **단일 실행 기준점**은 [`10-consolidated-execution-plan.md`](./10-consolidated-execution-plan.md). 근거는 [`03-proposal.md`](./03-proposal.md).
