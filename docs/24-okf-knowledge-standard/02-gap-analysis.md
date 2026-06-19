# 02. 갭 분석 — 현재 WekiFlow vs OKF 모델 (Gap Analysis)

> 01번에서 해부한 OKF의 3축(기준·정책·지속업데이트)을 현재 WekiFlow 구현/설계와 정면 비교한다.
> 근거: `docs/01-architecture.md`, `docs/03-data-model.md`, `docs/04-agent-tools.md`, `docs/22-main-agent-architecture.md`, `WekiFlow PRD v4.0.md`.

---

## 0. 현재 WekiFlow를 한 문장으로

> "인입된 정보를 에이전트가 **샌드박스 grep으로 팩트체크하며 병합**하고, **사람이 Monaco Diff로 검토·승인**하면 **MongoDB에 PUBLISHED 문서로 저장**되고, 백그라운드 워커가 **트리플을 추출해 KG를 쌓는** — 이벤트 구동(event-driven) 지식 형상관리 워크스페이스."

강점은 분명하다: **할루시네이션 차단(grep 검증) + Human-in-the-loop + Hybrid RAG**. 그러나 *지식을 무엇으로 보고 어디에 두는가*, *어떻게 신뢰를 거버넌스하고 시간에 따라 갱신하는가*에서 OKF와 갈린다.

---

## 1. 축별 정면 비교

### 1.1 기준 (Standard) — 지식의 표현 형식

| 항목 | OKF | 현재 WekiFlow | 갭 |
| :--- | :--- | :--- | :--- |
| 형식 표준 | `SPEC.md` v0.1 (버전드, 적합성 MUST) | 없음 — `contentMarkdown`은 자유 형식 MD | 🔴 **표준 부재** |
| 메타데이터 계약 | 필수 `type` + 권장 `title/description/resource/tags/timestamp` | `documents` 스키마에 `slug/title/status/version` 등은 있으나 **frontmatter 계약·`type`·`resource`·`tags` 없음** | 🔴 |
| 구조 관례 | `# Schema`/`# Examples`/`# Citations` | 본문 구조 규약 없음 | 🟠 |
| 출처(provenance) | `# Citations` + `references/` (사람 가독) | `sourceRefs[]`(minio:// 등, 기계용) — 본문 인용과 분리 | 🟠 |
| 이식성/diff | git-diffable plain text, 조직 간 이식 | MongoDB 도큐먼트 — **export·diff·이식 불가** | 🔴 **락인** |

> **결론:** WekiFlow에는 "지식이란 이런 모양이어야 한다"는 *기준*이 없다. MD 본문은 자유 형식이고, 메타데이터는 운영용 스키마일 뿐 *지식의 의미*를 담는 계약이 아니다.

### 1.2 System of Record (진실의 원천) — 가장 큰 구조적 차이

| | OKF | 현재 WekiFlow |
| :--- | :--- | :--- |
| **SoT** | **git-backed 마크다운 번들** | **MongoDB `documents`** |
| 벡터/그래프의 위상 | 번들에서 파생 가능한 인덱스(개념상) | KG·벡터가 **1급 저장소이자 부분적 SoT** (재빌드 경로 불명확) |
| 재현성 | 번들만 있으면 어디서든 동일 재현 | DB 덤프 의존, 인덱스/그래프 재빌드 절차 비표준 |
| 백업/이력 | git history = 완전한 시간여행 | `version: 7` 정수 카운터 + `updatedAt`만 (스냅샷 이력 부재) |

> **이것이 "현재 구조를 버려도 된다"가 가장 크게 작용하는 지점이다.** 진실의 원천을 DB에 두는 한, 이식성·감사성·재현성은 구조적으로 막혀 있다.

### 1.3 정책 (Policy) — 신뢰·거버넌스

| 정책 영역 | OKF | 현재 WekiFlow | 갭 |
| :--- | :--- | :--- | :--- |
| 소스 신뢰 등급 | domain allowlist(`--web-allowed-host`) | 없음 — 인입 소스 신뢰도 구분 없음 | 🔴 |
| 자원 상한 | crawl 상한(`--web-max-pages`) | 에이전트 **step 상한(12)** 은 있음(루프 폭주 방지) | 🟢 부분 존재 |
| 인용 의무 | 적합성 + `# Citations` | `tool_verify_integrity`로 *수치/조항* 검증(강력!) 하나 **인용 기록을 본문 정책으로 강제하진 않음** | 🟠 |
| 검토 게이트 | (스펙 밖, 운영 영역) | **`ADMIN`/`REVIEWER` 승인 게이트**(강력!) + `reviewApprovalEnabled` 토글 | 🟢 **우위** |
| 신선도 SLA | `timestamp` 신호(정책은 운영자 몫) | 없음 — 오래된 지식 식별 불가 | 🔴 |
| 정책의 형식 | 실행 파라미터로 코드화 | **암묵적**(코드에 흩어진 상수·RBAC) — 선언적 정책 파일 없음 | 🔴 |

> **결론:** WekiFlow의 정책은 **사람 검토 게이트와 grep 검증**이라는 두 강력한 기둥이 있으나, **선언적·중앙집중적 정책(소스 신뢰·신선도·인용 의무)** 이 없다. 정책이 코드 곳곳에 암묵적으로 흩어져 있다.

### 1.4 지속 업데이트 (Continuous Update) — 시간에 따른 갱신

| 항목 | OKF | 현재 WekiFlow | 갭 |
| :--- | :--- | :--- | :--- |
| 갱신 트리거 | **이벤트(인입) + 스케줄(재방문)** | **이벤트(인입) only** | 🔴 **재검증 루프 부재** |
| 외부 소스 보강 | Web Pass(권위 소스 크롤) | 없음 — 인입된 것만 처리 | 🔴 |
| 생성/갱신 분리 | enhance / create / skip 3중 판단 | `tool_merge`가 병합(갱신)은 함. 신규/갱신 판단 정책은 없음 | 🟠 |
| 변경 이력(사람용) | 개념별 `log.md` | **`jobs.agentSteps`(기계 감사용)** + `changeSummary`(1회성 diff 요약) | 🔴 **개념 이력 부재** |
| 신선도 감지 | `timestamp` 기반 stale 판단 | 없음 | 🔴 |
| 재인덱싱/재추출 | 번들 변경 시 인덱스 재빌드 | 인입 이벤트에만 의존 | 🟠 |

> **결론:** WekiFlow는 "들어온 정보를 처리"하는 데 최적화돼 있지만, **"이미 가진 지식이 시간이 지나 틀려지는 것"을 잡아내는 메커니즘이 전무**하다. OKF가 지목한 *continuous update*의 핵심(스케줄 재방문 + 신선도 + 개념 이력)이 통째로 비어 있다.

---

## 2. WekiFlow가 OKF보다 *우위*인 부분 (버리면 안 되는 것)

OKF는 지식 *표현/거버넌스 표준*이지, 지식 *생산 품질*을 보장하진 않는다. 여기서 WekiFlow가 강하다:

| WekiFlow 강점 | 설명 | OKF에 없음 |
| :--- | :--- | :--- |
| **샌드박스 grep 팩트체크** | `tool_execute_sandbox_terminal` + `tool_verify_integrity` — 수치·조항을 원문에서 결정론적으로 재확인, 할루시네이션 원천 차단 | OKF enrichment는 LLM 크롤·요약에 의존(검증 약함) |
| **Human-in-the-loop 승인** | Monaco Diff 검토 + RBAC 승인 게이트 | OKF 스펙 밖 |
| **Hybrid RAG(Vector+Graph+RRF)** | `tool_hybrid_retrieve`로 의미검색+멀티홉 융합 | OKF는 표현만, 검색 융합은 별도 |
| **샌드박스 보안 하드닝** | network=none, read-only, cgroup 제한, 감사 로깅 | OKF 무관 |

> **함의:** 우리는 OKF의 *표현·거버넌스·갱신 모델*을 가져오되, WekiFlow의 *생산·검증·검토 엔진*은 그대로 살린다. 둘은 **직교(orthogonal)** 하며 결합 시 시너지가 크다 — OKF가 약한 "검증"을 WekiFlow가, WekiFlow가 약한 "표준·이력·갱신"을 OKF가 메운다.

---

## 3. 버려야/강등해야 할 것 (Discard / Demote)

사용자의 "현재 구조나 기능을 버려도 된다"에 대한 구체적 답:

| 대상 | 처분 | 이유 |
| :--- | :--- | :--- |
| **"MongoDB = 진실의 원천" 가정** | 🔻 **강등** (SoT를 git 번들로 이전, DB는 파생 인덱스) | 이식성·재현성·감사성의 구조적 병목 |
| **`documents.contentMarkdown` 자유 형식** | 🔻 **대체** (WKF frontmatter 계약 + 구조 관례 적용) | 표준 부재 해소 |
| **`version` 정수 카운터** | 🔻 **대체** (git history + `log.md`) | 스냅샷 이력 불가 |
| **`sourceRefs[]`(기계용 출처)** | ♻️ **승격** (본문 `# Citations` + frontmatter `resource`로 사람 가독화) | provenance 가시성 |
| 샌드박스/검토/Hybrid RAG | ✅ **유지** | OKF와 직교, 핵심 강점 |
| 듀얼 파이프라인 A/B | ✅ **유지** + 파이프라인 C(큐레이션) 신설 | 지속 업데이트 보강 |

---

## 4. 갭 요약 스코어카드

| 축 | 현재 충족도 | 가장 큰 빈틈 |
| :--- | :--- | :--- |
| 기준(Standard) | 🔴 20% | 형식 표준·frontmatter 계약·이식성 부재 |
| System of Record | 🔴 30% | DB 락인, 재현성·git 이력 부재 |
| 정책(Policy) | 🟠 50% | 검토 게이트는 강하나 선언적 정책·신선도·소스신뢰 부재 |
| 지속 업데이트 | 🔴 25% | 스케줄 재검증·신선도·개념별 변경 이력 전무 |
| 생산/검증 품질 | 🟢 85% | (OKF 대비 우위) — 유지 대상 |

→ 빈틈이 가장 큰 **기준 / SoT / 지속업데이트**를 [`03-proposal.md`](./03-proposal.md)에서 설계로 메운다.
