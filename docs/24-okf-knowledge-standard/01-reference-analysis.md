# 01. knowledge-catalog / OKF 심층 분석 (Reference Analysis)

> Google Cloud `knowledge-catalog` 저장소를 **정책(Policy) · 기준(Standard) · 지속 업데이트(Continuous Update)** 세 축으로 해부한다.
> 출처: [github.com/GoogleCloudPlatform/knowledge-catalog](https://github.com/GoogleCloudPlatform/knowledge-catalog) (Apache-2.0, 비공식 Google 제품). 본 분석은 저장소의 `README`, `okf/SPEC.md`, `okf/README.md`, 디렉터리 구조를 근거로 한다.

---

## 0. 저장소 전체 개관 (What the repo is)

`knowledge-catalog`은 Google Cloud **Knowledge Catalog**(구 Dataplex, "AI-powered data catalog & metadata management platform")의 기능을 시연하는 도구·에이전트·샘플 모음이다. 핵심 주장은 *"정형·비정형 데이터 전체의 동적 지식 그래프(dynamic knowledge graph)를 만들어 AI 에이전트에 의미(semantics)와 비즈니스 맥락(business context)을 제공한다"* 이다.

디렉터리 구조:

| 디렉터리 | 역할 |
| :--- | :--- |
| `agents/` | AI 에이전트 구현 |
| **`okf/`** | **Open Knowledge Format** PoC — 본 검토의 핵심 |
| `samples/` | 예제·데모 |
| `toolbox/` | 유틸리티 도구 |

언어 구성: Python 61% / TypeScript 24% / HTML 14%. 우리 검토에서 **가장 중요한 것은 코드가 아니라 `okf/`가 제시하는 *개념 모델*** 이다 — 지식을 어떻게 표현·거버넌스·갱신하는가.

---

## 1. OKF(Open Knowledge Format)란 무엇인가

> *"지식 — 데이터·시스템을 둘러싼 메타데이터·맥락·큐레이션된 통찰 — 을 표현하기 위한, 사람과 에이전트 모두에게 친화적인 개방 포맷."*

OKF의 설계 우선순위(직접 인용 요지):

- **도구 없이 사람이 읽을 수 있어야** 한다 (readable by humans without tools)
- **SDK 없이 에이전트가 파싱할 수 있어야** 한다 (parseable by agents without SDKs)
- **버전관리에서 diff 가능해야** 한다 (diffable in version control)
- **조직 간 이식 가능해야** 한다 (portable across organizations)

→ 형식은 **"YAML frontmatter를 가진 평범한 마크다운 파일들의 계층적 디렉터리"** = **번들(bundle)**. 배포는 git 저장소(권장), tarball, 또는 큰 저장소의 하위 디렉터리로 가능.

> **핵심 통찰:** OKF의 본질은 "지식 = 코드처럼 다루는 파일"이다. DB 레코드가 아니라 *git-diffable plain text*. 이 한 가지 선택에서 이식성·감사성·재현성·사람가독성이 전부 파생된다.

---

## 2. 축 ① — 기준 (Standard): `SPEC.md`

OKF는 **버전드 스펙(versioned spec)** 으로 형식을 *표준화* 한다. 이것이 "기준"의 본체다.

### 2.1 번들 구조와 예약 파일

- 번들 = 마크다운 파일들의 계층적 디렉터리.
- **예약 파일명(정의된 의미를 가짐):**
  - `index.md` — 디렉터리 목록(listing). frontmatter 없음(단, 번들 루트의 `index.md`만 `okf_version` 선언 허용).
  - `log.md` — **업데이트 이력(update history)**. ← 지속 업데이트 축의 핵심.
- 그 외 모든 `.md` = **개념 문서(concept document)**.

### 2.2 Frontmatter 스키마 (필수 vs 권장)

| 키 | 등급 | 의미 |
| :--- | :--- | :--- |
| `type` | **필수(Required)** | 개념의 종류를 식별하는 짧은 문자열. 중앙 등록 없음 — 생산자가 자유 선택(예: `"BigQuery Table"`, `"Metric"`, `"Playbook"`). 소비자는 모르는 type도 관용적으로 처리해야 함. |
| `title` | 권장 | 사람이 읽는 표시명. 없으면 파일명에서 유추 가능. |
| `description` | 권장 | 개념을 요약하는 한 문장. |
| `resource` | 권장 | 개념이 기술하는 실제 자산을 식별하는 **URI**(고유 식별자). |
| `tags` | 권장 | 교차 분류용 짧은 문자열의 YAML 리스트. |
| `timestamp` | 권장 | **마지막 의미 있는 변경의 ISO-8601 시각.** ← 신선도(freshness) 판단 근거. |
| (임의 확장) | 선택 | 생산자는 추가 키를 넣을 수 있고, **소비자는 모르는 키를 보존(preserve)** 해야 함. |

### 2.3 문서 본문 관례 (Conventional sections)

표준 마크다운 + 선택적 관례 섹션 헤딩:
- `# Schema` — 정형 자산의 구조 기술
- `# Examples` — 사용 예시(예: 쿼리)
- `# Citations` — 외부 출처(번호 링크). 출처는 절대 URL / 번들상대경로 / `references/` 하위 참조 가능.

> "freeform 산문보다 **구조(structure)를 선호**" — 즉 LLM·사람 양쪽이 일관되게 소비하도록 섹션을 규약화.

### 2.4 교차 링크 (Cross-linking)

- **절대(번들 상대):** `/`로 시작, 번들 루트 기준. **안정성 위해 권장.**
- **상대:** 일반 마크다운 경로.
- 링크는 *관계가 있음*을 단언하되, **관계의 종류는 링크가 아니라 주변 산문이 표현**한다. 소비자는 깨진 링크를 관용해야 한다.

### 2.5 적합성 규칙 (Conformance) — "기준"을 강제하는 최소 계약

**적합한 번들의 의무(MUST):**
1. 모든 비예약 `.md`에 파싱 가능한 YAML frontmatter가 있을 것
2. 모든 frontmatter에 비어있지 않은 `type` 필드가 있을 것
3. 예약 파일명은 정해진 구조를 따를 것

**소비자의 의무(MUST NOT reject):** 누락된 선택 필드 / 모르는 type / 모르는 키 / 깨진 링크 / 없는 index 파일을 이유로 번들을 거부하면 안 된다. → **"엄격한 코어 + 관대한 확장(strict core, liberal extension)"** 원칙.

### 2.6 버전 관리 (Versioning)

- `<major>.<minor>` 체계. minor = 하위호환 추가, major = 파괴적 변경 허용.
- 번들은 루트 `index.md` frontmatter에 `okf_version: "0.1"`로 목표 버전 선언 가능.
- 소비자는 미선언 버전도 best-effort로 소비.

> **설계 철학(명시적 비목표):** OKF는 ① 고정 분류체계(taxonomy)를 정의하지 않고 ② 저장 인프라를 규정하지 않으며 ③ 도메인 스키마를 대체하지 않는다. 대신 Avro·Protobuf 같은 기존 표준을 **"참조(reference)"** 한다. → "최소한으로만 의견을 갖고(minimally opinionated), 자유롭게 확장 가능(freely extensible)".

---

## 3. 축 ② — 정책 (Policy): enrichment 에이전트의 가드레일

OKF의 "정책"은 거창한 거버넌스 프레임워크가 아니라, **enrichment 에이전트가 지식을 만들 때 지켜야 하는 *선언적 가드레일*** 로 구현된다.

| 정책 항목 | 구현 메커니즘 | 효과 |
| :--- | :--- | :--- |
| **소스 신뢰(domain allowlist)** | `--web-allowed-host` | 크롤러가 승인된 도메인 밖으로 나가지 못함 |
| **자원 상한(crawl ceiling)** | `--web-max-pages` | 총 fetch 수 하드 제한 → "에이전트가 폭주할 수 없다(cannot overrun)" |
| **출처(provenance) 의무** | `# Citations` 섹션 + `references/` | 모든 외부 지식에 출처 기록 |
| **생성 vs 갱신 분리** | 신규 발견 → `references/`의 독립 문서, 관련 내용 → 기존 개념에 *enrich* | 개념의 출처 명확성(provenance clarity) 유지 |
| **적합성(conformance)** | §2.5 MUST 규칙 | 기준 미달 산출물 차단 |

> **핵심 통찰:** 정책이 *문서(가이드라인)* 가 아니라 **에이전트 실행 파라미터·포맷 계약으로 코드화**되어 있다. 즉 "지키면 좋은 것"이 아니라 "어기면 실행이 막히는 것". 이것이 우리가 가져와야 할 패턴이다.

---

## 4. 축 ③ — 지속 업데이트 (Continuous Update)

OKF의 가장 가치 있는 부분이자 사용자가 명시적으로 지목한 영역. 두 메커니즘으로 구성된다.

### 4.1 2-Pass Enrichment 에이전트 (knowledge production)

Google ADK(Agent Development Kit) 기반 에이전트가 **두 단계**로 지식 번들을 구축:

```
[Pass 1 · BQ Pass — 초기 카탈로그]
  BigQuery 메타데이터 introspection
  ➜ 식별된 개념마다 OKF 문서 1개 생성 (구조적 메타데이터만)
        │
        ▼
[Pass 2 · Web Pass — 맥락 보강]
  seed URL 수신 ➜ fetch 도구로 페이지 크롤
  ➜ 페이지마다 에이전트가 3중 판단:
       (a) 기존 개념 문서를 보강(enhance)
       (b) 새 reference 문서를 생성(create)
       (c) 건너뜀(skip)
  가드레일: --web-max-pages(상한), --web-allowed-host(도메인 제한)
```

> **선순환 구조:** 구조적 씨앗(BQ) → 권위 있는 맥락(Web)으로 *겹겹이 쌓는다(layering)*. 우리 WekiFlow의 "파이프라인 B가 만든 그래프가 다음 A의 소스가 된다"는 선순환과 철학이 동일하나, OKF는 **외부 권위 소스를 끌어와 갱신**한다는 점이 다르다.

### 4.2 `log.md` + `timestamp` (change history & freshness)

- **`log.md`** — 개념/번들의 변경 이력. 날짜별 그룹(ISO-8601, 최신 우선), `**Update**`·`**Creation**` 같은 관례적 굵은 접두사(권고이지 강제 아님).
- **`timestamp` frontmatter** — 개념의 "마지막 의미 있는 변경" 시각.

이 둘이 결합되어 **신선도(freshness) 기반 갱신**의 토대가 된다:
- 사람·에이전트가 `log.md`로 "이 지식이 언제, 왜, 무엇이 바뀌었나"를 읽는다.
- `timestamp`로 "이 개념이 오래되었나(stale)"를 판단해 재방문 우선순위를 정할 수 있다.

> **핵심 통찰:** OKF의 지속 업데이트 = ① *생성/갱신을 분리한* enrichment 루프 + ② *사람이 읽는 변경 이력(log.md)* + ③ *신선도 신호(timestamp)*. 기계 감사 로그(우리의 `jobs.agentSteps`)와 달리, **개념 단위로 사람이 읽고 신뢰를 판단할 수 있는** 이력이라는 점이 결정적이다.

---

## 5. 요약 — OKF가 형식화한 3가지 (한눈에)

| 축 | OKF의 메커니즘 | 한 줄 요지 |
| :--- | :--- | :--- |
| **기준(Standard)** | `SPEC.md` v0.1 — frontmatter 계약, 예약 파일, 적합성 MUST, 버전관리 | "지식을 git-diffable 표준 문서로" |
| **정책(Policy)** | enrichment 가드레일 — allowlist, 크롤 상한, 출처 의무, 적합성 게이트 | "정책을 문서가 아니라 *실행 계약*으로 코드화" |
| **지속 업데이트(Continuous Update)** | 2-pass enrichment + `log.md` + `timestamp` | "생성/갱신 분리 + 사람이 읽는 이력 + 신선도 신호" |

다음 문서([`02-gap-analysis.md`](./02-gap-analysis.md))에서 이 3축을 현재 WekiFlow와 정면 비교한다.
