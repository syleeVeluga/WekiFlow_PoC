# 04. WKF v0.1 초안 — WekiFlow Knowledge Format (Spec Draft)

> OKF v0.1을 **WekiFlow에 맞게 구체화한 지식 포맷 초안**. OKF와 호환(상위호환 지향)하되, WekiFlow의 검증·KG·검토 기능에 필요한 키를 추가한다.
> 이 문서는 [`03-proposal.md`](../../archive/okf-knowledge-standard/03-proposal.md) Phase 5의 입력물이다. 확정 시 `packages/wkf`가 이 스펙을 구현한다.

---

## 1. 설계 원칙 (OKF 계승)

- **엄격한 코어 + 관대한 확장** — `type`만 필수, 모르는 키는 보존(preserve).
- **사람·에이전트 양용** — 도구 없이 읽히고, SDK 없이 파싱되며, git에서 diff된다.
- **OKF 호환** — OKF 번들을 그대로 소비할 수 있고, WKF는 OKF에 확장 키만 더한 superset.
- **저장 인프라 비규정** — 본 스펙은 *파일 형식*만 정의. MongoDB는 파생 인덱스일 뿐.

---

## 2. 번들 레이아웃 (Bundle Layout)

```
knowledge/                         # git 저장소 루트(= System of Record)
├── index.md                       # 루트 목록 + okf_version/wkf_version 선언
├── policy.yaml                    # ★ WKF 확장: 거버넌스 정책
├── hr/
│   ├── index.md                   # 디렉터리 목록(선택)
│   ├── log.md                     # ★ 변경 이력(디렉터리 단위)
│   ├── annual-leave.md            # 개념 문서
│   └── business-trip.md
├── finance/
│   └── ...
└── references/                    # 외부 출처 보관(enrichment 산출물)
    └── labor-law-2026.md
```

| 파일 | 의미 | 출처 |
| :--- | :--- | :--- |
| `*.md` | 개념 문서 | OKF |
| `index.md` | 디렉터리 목록 (frontmatter 없음; 루트만 버전 선언) | OKF |
| `log.md` | 변경 이력 (날짜 그룹, 최신 우선) | OKF |
| `policy.yaml` | **거버넌스 정책** | ★ WKF 확장 |
| `references/` | 외부 출처 문서 | OKF |

---

## 3. Frontmatter 스키마

### 3.1 필수 / 권장 (OKF 계승)

```yaml
---
type: REGULATION              # [필수] 개념 종류. 자유 문자열이나 WKF는 권장 어휘 제공(§3.3)
title: 연차 휴가 규정          # [권장] 표시명
description: 신입·재직자 연차 부여와 결재 권한 규정   # [권장] 한 문장 요약
resource: wekiflow://hr/annual-leave        # [권장] 개념의 고유 식별 URI
tags: [hr, leave, policy]     # [권장] 교차 분류
timestamp: 2026-06-19T09:00:00Z             # [권장] 마지막 의미 있는 변경(ISO-8601) — 신선도 근거
---
```

### 3.2 WKF 확장 키 (★ WekiFlow 전용)

```yaml
# --- 거버넌스/지속업데이트 ---
freshness: 90d                # 재검증 주기(미지정 시 policy.yaml의 type 기본값)
source_tier: official         # 소스 신뢰 등급: official | internal | external | unverified
review_required: true         # 검토 게이트 필요 여부(false면 자동 PUBLISHED 허용)
last_verified: 2026-06-19T09:00:00Z   # 파이프라인 C가 "사실 재확인"한 시각(변경 없어도 갱신)

# --- WekiFlow 파이프라인 연동 ---
status: PUBLISHED             # DRAFT|PROCESSING|REVIEW|PUBLISHED (DB status와 동기화)
slug: hr/annual-leave         # 트리 경로(파생; 파일 경로에서 유도 가능)
kg_indexed: true              # 파이프라인 B가 트리플 추출 완료했는지(파생 인덱스 상태)
```

> **호환성 규칙:** WKF 소비자는 위 확장 키를 이해하지만, **OKF-only 소비자는 이들을 단순 보존**한다(거부 금지). 역으로 WKF는 OKF 번들의 모르는 키를 보존한다.

### 3.3 권장 `type` 어휘 (열린 집합)

OKF처럼 중앙 등록은 없으나, KG 엔티티 타입(`docs/03` §4)과 정합을 위해 권장 어휘를 둔다:

`REGULATION`(규정/조항) · `POLICY`(정책) · `PLAYBOOK`(절차) · `METRIC`(지표) · `ENTITY`(일반 개념) · `DATASET`(데이터셋) · `PERSON`/`DEPT`(조직). 소비자는 **모르는 type도 관용** 처리(OKF MUST).

---

## 4. 문서 본문 관례 (Body Conventions)

OKF의 `# Schema`/`# Examples`/`# Citations`에 WKF가 `# Facts`(검증 대상)와 `# Relations`(타입드 링크 = 그래프 직렬화)를 추가:

```markdown
## 제4조 (연차 부여)
신입사원은 입사와 동시에 연차 16일을 부여받는다.

# Facts                         <!-- ★ WKF: tool_verify_integrity 검증 앵커 -->
- 신입 연차: 16일
- 결재 권한자: 부서장

# Relations                     <!-- ★ WKF: 타입드 링크 → kg_nodes/kg_edges 재빌드 소스 -->
- (신입사원) -[부여받는다]-> (연차 16일)  {strength: 0.9}
- (연차 규정) -[결재권한자]-> (부서장)     {strength: 0.95, ref: /finance/approval.md}

# Citations                     <!-- OKF: 출처(번호 링크) -->
1. [취업규칙 v3](/references/employment-rules-v3.md)
2. [HR 공지 2026-06-15](https://intra.example.com/notice/123)
```

- `# Facts`의 각 항목은 **`tool_verify_integrity`가 샌드박스 grep으로 원문 대조**하는 앵커. 인용 없는 사실은 정책상 검증 실패 처리 가능(§5).
- 교차 링크는 OKF 규칙: 절대(`/`로 시작, 번들 상대) 권장.

### 4.1 `# Relations` — OKF 링크를 그래프로 확장 (★ 설계 근거)

> **왜 평범한 OKF 링크로는 부족한가:** OKF의 마크다운 링크는 "관계가 *있다*"만 단언하고 **관계의 종류(술어)는 주변 산문에 맡긴다**. 그래서 ① 무(無)타입 ② 문서↔문서 단위 ③ 가중치 없음 — 즉 *문서 수준 연관 그래프*까지만 표현된다. 반면 WekiFlow의 `tool_search_graph`는 **엔티티↔엔티티의 타입드·방향성·가중치 관계를 술어 체인으로 멀티홉 추론**해야 하므로, 평범한 링크로는 대체되지 않는다.

WKF는 OKF 링크의 정신(지식 간 연결을 마크다운에 명시)을 살리되, **술어·방향·가중치를 담는 타입드 링크**로 확장한다:

```
(Subject) -[Predicate]-> (Object)  {strength: 0..1, ref: /bundle/relative/path.md}
```

| 요소 | 의미 | KG 매핑(docs/03 §4) |
| :--- | :--- | :--- |
| `(Subject)`/`(Object)` | 엔티티 표면형 | `kg_nodes.name` → `normalizedName`으로 정규화 |
| `[Predicate]` | 관계 술어 | `kg_edges.predicate` |
| `{strength}` | 0~1 중요도 | `kg_edges.strength` |
| `{ref}` | (선택) 대상 개념 문서 링크 | OKF 교차 링크와 호환 |

**동작:**
- 파이프라인 B(트리플 추출)는 DB에 직접 쓰지 않고 **`# Relations` 섹션을 생성/갱신**한다(출력 재배선).
- `wkf reindex`가 이 섹션을 파싱해 `kg_nodes`/`kg_edges`를 재빌드 → **그래프의 진실의 원천이 번들이 되고, MongoDB KG는 파생 인덱스로 강등**된다.
- 멀티홉 추론(`$graphLookup`)과 `tool_search_graph`는 **그대로 보존**된다(질의는 여전히 DB에서).
- OKF-only 소비자에겐 `# Relations`가 단순 텍스트로 보존되어 호환성 유지.

> **요지:** "OKF 링크가 그래프를 *대체*한다"가 아니라, "**OKF 번들이 그래프의 SoT가 되고, 링크를 술어까지 담도록 확장**한다". 사람이 git diff로 관계 변경을 리뷰할 수 있게 되는 것이 부가 이득이다.

---

## 5. `policy.yaml` 스키마 (★ WKF 핵심 확장)

거버넌스 정책을 **선언적·중앙집중적**으로 기술. 파이프라인이 이를 *강제*한다.

```yaml
wkf_version: "0.1"

# 1) 지식 유형별 신선도 SLA (파이프라인 C 구동)
freshness:
  REGULATION: 90d         # 규정은 90일마다 재검증
  POLICY: 180d
  METRIC: 30d
  default: 365d

# 2) 소스 신뢰 등급 (인입·enrichment 게이트)
sources:
  tiers: [official, internal, external, unverified]
  # external/unverified는 검토 게이트 강제, official은 자동 통과 허용
  auto_publish_max_tier: internal
  # 외부 enrichment 도메인 allowlist (OKF --web-allowed-host 대응)
  allowed_hosts:
    - intra.example.com
    - law.go.kr

# 3) enrichment 자원 상한 (OKF --web-max-pages 대응)
enrichment:
  web_max_pages: 50
  agent_step_limit: 12       # 기존 stopWhen(12)과 정합

# 4) 인용 의무
citations:
  required_for: [REGULATION, POLICY]   # 이 type은 # Citations 없으면 검증 실패
  require_fact_verification: true        # # Facts 항목은 grep 대조 필수

# 5) 검토 권한 (RBAC 연동; docs/03 §6)
review:
  approver_roles: [ADMIN, REVIEWER]
  # type별 승인 등급 오버라이드
  overrides:
    REGULATION: [ADMIN]      # 규정은 ADMIN만 승인

# 6) 적합성 게이트
conformance:
  reject_on_missing_type: true     # type 없으면 커밋 차단(OKF MUST)
  block_commit_on_validate_fail: true
```

> **강제 지점:** `wkf validate`(커밋 전), 인입/enrichment 워커(소스 tier·allowlist), 파이프라인 C(freshness), `tool_verify_integrity`(citations), API 검토 라우트(review roles).

---

## 6. `log.md` 형식 (변경 이력)

```markdown
## 2026-06-19
- **Update** annual-leave.md: 신입 연차 15→16일 (출처: HR 공지 2026-06-15, src_tier: official). 검토 sylee. [C]
- **Verify** business-trip.md: 변경 없음, 재검증 완료. [C]

## 2026-03-01
- **Creation** annual-leave.md: 취업규칙 v3 기반 최초 등록. 검토 sylee. [A]
```

- 날짜 그룹, 최신 우선(OKF). 접두사 `**Creation**`/`**Update**`/`**Verify**`.
- 말미 `[A]`/`[B]`/`[C]` = 어느 파이프라인이 변경했는지(WKF 확장, 선택).
- **모든 승인은 자동으로 1줄 append.**

---

## 7. 적합성 규칙 (Conformance — `wkf validate`)

번들이 적합(conformant)하려면 (OKF MUST 계승):

1. 모든 비예약 `.md`에 파싱 가능한 YAML frontmatter 존재.
2. 모든 frontmatter에 비어있지 않은 `type` 존재.
3. 예약 파일(`index.md`/`log.md`/`policy.yaml`)은 정해진 구조 준수.
4. **(WKF 추가)** `policy.yaml`의 `citations.required_for` type은 `# Citations` 섹션 보유.

소비자는 다음을 이유로 **거부 금지**: 누락된 권장 필드 / 모르는 type / 모르는 키 / 깨진 링크 / 없는 index.

---

## 8. `packages/wkf` API 초안

```ts
// 파싱·직렬화
parse(md: string): { frontmatter: Frontmatter; body: string }
serialize(doc: WkfDoc): string                 // documents → MD 파일
fromMongo(doc: MongoDocument): WkfDoc           // 기존 스키마 어댑터

// 적합성
validate(bundlePath: string, policy: Policy): ValidationResult   // wkf validate

// 관계(그래프) 직렬화/파싱
parseRelations(body: string): Triplet[]          // # Relations 섹션 → 트리플 배열
serializeRelations(triplets: Triplet[]): string  // 트리플 → # Relations 섹션(파이프라인 B 출력)

// SoT 동기화 (Phase 6)
exportBundle(db, bundlePath): void              // wkf export  (DB → 번들)
reindex(bundlePath, db): void                   // wkf reindex (번들 → 벡터/KG 재빌드, 멱등; # Relations → kg_*)

// 지속 업데이트 (Phase 7)
scanStale(bundlePath, policy): WkfDoc[]          // freshness SLA 초과 개념
appendLog(dir, entry): void                      // log.md 1줄 추가
```

---

## 9. 기존 데이터 모델과의 매핑 (docs/03 ↔ WKF)

| `documents` 필드 (현재) | WKF 표현 | 비고 |
| :--- | :--- | :--- |
| `contentMarkdown` | `.md` body | 본문 |
| `title` | frontmatter `title` | |
| `slug` | 파일 경로 + frontmatter `slug` | 경로가 1차 |
| `status` | frontmatter `status` | DB와 동기화 |
| `parentId`(인접리스트) | **디렉터리 계층** | 트리를 파일시스템으로 표현 |
| `version`(정수) | **git history** | 카운터 폐기 |
| `sourceRefs[]` | `# Citations` + `resource` | 사람 가독화 |
| `approvedBy` | `log.md` 검토자 기록 | |
| `chunks`/`kg_*` | **파생 인덱스**(번들에서 재빌드) | SoT 아님 |

---

## 10. 미해결 결정 (확정 필요)

1. **트리 표현**: 디렉터리 계층 only vs `parentId` 병행? (제안: 디렉터리 1차, slug 보조)
2. **`type` 어휘 고정 범위**: KG 엔티티 타입과 100% 일치시킬지, 느슨하게 둘지.
3. **freshness 기본값**: REGULATION 90d / POLICY 180d가 적정한지 (정책 디폴트).
4. **외부 enrichment 활성화 여부**: 사내 grep 재검증만 vs 외부 allowlist 크롤까지.

> 위 결정과 [`03-proposal.md`](../../archive/okf-knowledge-standard/03-proposal.md) §2의 SoT 역전 여부가 확정되면 `packages/wkf` 구현(Phase 5)을 시작할 수 있다.
