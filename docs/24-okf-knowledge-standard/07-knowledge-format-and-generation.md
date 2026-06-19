# 07. 지식 포맷 템플릿 · 재현 가능 생성 · 적합성 테스트 (Format, Recipes, Conformance)

> OKF 예시 번들(GA4·Stack Overflow·Bitcoin)·recipe·`okf/tests`를 코드 레벨까지 분석해 **WKF에 바로 쓸 수 있는 템플릿·생성 프로토콜·자동 테스트**로 옮긴다.
> 모든 인용은 실제 저장소 파일에서 발췌. → 문서 [`04`](./04-wekiflow-knowledge-spec.md)(스펙)·[`05`](./05-curation-agent.md)(가드레일)을 *구현 가능한 형태*로 구체화.

---

## 1. 실제 개념 문서 템플릿 (검증된 형태)

OKF Bitcoin 번들의 실제 파일(`bundles/crypto_bitcoin/tables/transactions.md`) — **우리 WKF 개념 문서의 직접 템플릿**:

```markdown
---
type: BigQuery Table
resource: https://.../tables/transactions
title: Bitcoin Transactions
description: A comprehensive table detailing all transactions on the Bitcoin blockchain.
tags: [bitcoin, blockchain, transactions, crypto, public data, etl]
timestamp: '2026-05-28T22:45:04+00:00'
---

본문 산문: transactions 테이블은 [crypto_bitcoin](../datasets/crypto_bitcoin.md)
데이터셋에서 ... 각 행은 한 트랜잭션을 나타내며 ... [block](blocks.md) 정보를 포함한다.

# Schema
- `hash` STRING REQUIRED: 트랜잭션 해시
- `inputs` RECORD REPEATED: 트랜잭션 입력
  - `value` NUMERIC: 기준 통화 값

# Common query patterns
​```sql
SELECT DATE(block_timestamp) AS d, COUNT(hash) FROM `...transactions` GROUP BY d;
​```

# Citations
[1] [Bitcoin Transactions](https://.../tables/transactions)
[2] [Bitcoin ETL](https://github.com/blockchain-etl/bitcoin-etl)
```

**관찰된 사실:**
- frontmatter는 `---`로 구분된 YAML, `type` 필수 + `title/description/resource/tags/timestamp` 권장(전부 채워짐). `timestamp`는 ISO-8601.
- 본문은 **산문 → `# Schema` → `# Examples`(또는 `# Common query patterns`) → `# Citations`** 순서.
- 본문 내 **상대 링크**(`../datasets/crypto_bitcoin.md`, `blocks.md`)로 개념을 연결 — OKF 교차 링크. ← 우리 `# Relations`([`04` §4.1])의 약식 버전.
- `# Citations`는 번호 링크 `[1] [텍스트](url)`.

### WKF 개념 문서 표준 템플릿 (확정안)

위에 우리 확장(`# Facts`/`# Relations` + 거버넌스 frontmatter)을 더한 최종형:

```markdown
---
type: REGULATION
title: 연차 휴가 규정
description: 신입·재직자 연차 부여와 결재 권한 규정
resource: wekiflow://hr/annual-leave
tags: [hr, leave, policy]
timestamp: '2026-06-19T09:00:00Z'
source_tier: official          # WKF 확장
freshness: 90d                 # WKF 확장
last_verified: '2026-06-19T09:00:00Z'
---

본문 산문 ...

# Facts            <!-- grep 검증 앵커 -->
# Schema           <!-- (정형 자산일 때) 필드 정의 -->
# Examples         <!-- 사용 예 / 쿼리 -->
# Relations        <!-- 타입드 링크 → kg_* 재빌드 -->
# Citations        <!-- 번호 링크 출처 -->
```

> `# Schema`·`# Examples`는 우리 지식 유형 중 *데이터셋/지표* 류에 유용. *규정/정책* 류는 `# Facts`·`# Citations` 위주. type별로 권장 섹션을 `policy.yaml`에 둘 수 있다.

---

## 2. `references/` — 1급 개념으로서의 출처/용어집

Stack Overflow 번들은 `references/`에 **33개의 enum/용어 문서**(`vote_types.md`, `badge_classes.md` 등)를 둔다. 각 파일은 **자체 frontmatter를 가진 1급 OKF 개념**이지 단순 첨부가 아니다.

실제 `vote_types.md`:
```markdown
---
type: Reference
title: Vote Types
description: Enumerated types for votes ...
tags: [votes, enum, moderation, schema, data dump]
timestamp: '2026-05-28T23:33:26+00:00'
---
- `2`: UpMod (Upvote)
- `3`: DownMod (Downvote)
...
# Citations
[1] [Database schema documentation ...](https://...)
```

### WKF 채용
- 외부 권위 출처(노동법 조문, 사내 공지 원문, 용어 정의)를 **`references/`에 1급 개념으로** 보관 → enrichment(파이프라인 C)가 만든 근거 문서가 검색·인용·버전관리 대상이 됨.
- 규정 문서의 `# Citations`가 `references/`를 가리키게 하여 **출처 추적이 폐곡선**을 이룬다.

---

## 3. Recipe — 재현 가능한 지식 생성 (★ 채용 가치 높음)

각 번들은 `okf/samples/<bundle>/`에 **recipe**(생성 레시피)를 갖는다:
- 구성: `README.md`(목적) + **`seeds.txt`**(크롤 시드 URL 2~3개)
- 실행: 결정론적 단일 명령

```bash
python -m enrichment_agent enrich \
  --source bq --dataset bigquery-public-data.crypto_bitcoin \
  --web-seed-file samples/crypto_bitcoin/seeds.txt \
  --out ./bundles/crypto_bitcoin
```

실제 `seeds.txt`(Bitcoin):
```
# the canonical schema source
https://github.com/blockchain-etl/bitcoin-etl
# Bitcoin in BigQuery — foundational Google Cloud announcement
https://cloud.google.com/blog/products/gcp/bitcoin-in-bigquery-...
```

> **핵심:** *동일 입력(소스 스키마 + 시드 파일) → 동일 번들 출력*. 지식 번들이 **재현 가능(reproducible)** 하다.

### WekiFlow 채용 — "지식 번들 레시피"
- 각 지식 영역(예: `hr/`)마다 **`recipe.yaml`** 을 저장: 인입 소스 목록(데이터소스 ID/업로드 ref) + 시드(사내 위키 URL allowlist) + 생성 파라미터.
- 효과:
  - **재생성 가능:** 모델/프롬프트를 개선한 뒤 `wkf regenerate hr/`로 번들을 다시 만들 수 있음(파이프라인 A 재실행을 선언적으로).
  - **감사:** "이 지식이 어떤 소스에서 어떻게 만들어졌나"가 recipe로 남음 — `sourceRefs`보다 강한 provenance.
  - **파이프라인 C 연계:** recipe의 시드가 곧 재검증 크롤 대상([`05` §4]).

---

## 4. `index.md` 자동 생성 (네비게이션)

`index.md`는 **자동 생성**되는 디렉터리 목록(frontmatter 없음). 실제 GA4 루트:
```
# Subdirectories
* [datasets](datasets/index.md) - obfuscated GA4 event export ...
* [references](references/index.md) - specifications for data joins ...
* [tables](tables/index.md) - GA4 event export data ...
```
`okf/tests/test_index.py`가 검증하는 생성 규칙:
- 타입별 그룹화 + 상대경로 링크 + 설명을 자식에서 상속
- **빈 디렉터리 스킵**, **단일 자식이면 자식 설명 재사용**(중복 생성 방지)

### WKF 채용
- `wkf reindex`(또는 별도 `wkf index`)가 디렉터리 트리를 순회해 `index.md`를 멱등 생성 → 우리 **문서 트리(인접 리스트, `docs/03`)** 를 파일시스템 + index.md로 자연 표현. 프론트의 문서 트리는 index.md를 읽어 렌더.

---

## 5. ★ 적합성 테스트 — 가드레일을 *자동 테스트*로 (가장 실용적)

`okf/tests`가 검증하는 항목 → **우리 `wkf validate`/CI 테스트로 그대로 채용**. 특히 [`05` §2.3]의 "재작성 가드레일"을 *코드로 강제*하는 결정적 부분:

| OKF 테스트 | 검증 내용 | WKF 채용 |
| :--- | :--- | :--- |
| `test_document.py` 필수 필드 | `type` 등 없으면 reject | `wkf validate` 적합성 게이트 |
| `test_document.py` **Roundtrip** | parse→serialize가 frontmatter+본문 보존 | `wkf parse/serialize` 라운드트립 테스트(SoT 역전 안전성 증명, [`03` §7 Phase6 DoD]) |
| `test_document.py` YAML 보존 | 복잡한 리스트도 재직렬화 후 보존 | 모르는 키 보존(OKF 관용성) |
| **`test_bundle_tools.py` schema 비축소** | Web pass에서 **기존 스키마 필드 제거 금지** | **파이프라인 C 재작성 가드레일을 테스트로 강제** |
| **`test_bundle_tools.py` citation 비축소** | **인용 수 감소 금지** | 동일 — 출처 유실 차단 |
| `test_bundle_tools.py` 증강 허용 | 새 섹션 추가는 허용 | 가산적 보강만 허용([`05`]) |
| pass별 규칙 차등 | BQ pass는 축소 허용, Web pass는 엄격 / Reference 타입은 우회 | **우리 파이프라인별 차등:** 신규 인입(A)은 자유, 큐레이션(C) 재작성은 엄격 비축소 |

> **이게 핵심 채용 포인트다.** 문서 05에서 "헤딩·스키마를 줄이면 안 된다"를 *프롬프트 규칙*으로 적었는데, OKF는 그것을 **자동 테스트(`assert not schema_shrunk`)** 로 박아 두었다. 우리도 `wkf validate`에 **비축소(non-shrinkage) 어서션**을 넣으면, 큐레이션 에이전트가 문서를 망가뜨리는 커밋이 **CI/게이트에서 자동 차단**된다 — "지키면 좋은 가이드"가 아니라 "어기면 빌드 실패".

### 구현 스케치 (`packages/wkf` 테스트)
```ts
// 큐레이션 재작성(before→after) 비축소 검증
function assertNoShrinkage(before: WkfDoc, after: WkfDoc) {
  // 1) 모든 # 헤딩 보존(순서·문구)
  assertHeadingsPreserved(before.body, after.body);
  // 2) Schema 필드 수 비감소
  assert(schemaFieldCount(after) >= schemaFieldCount(before));
  // 3) Citations 수 비감소
  assert(citationCount(after) >= citationCount(before));
  // 4) frontmatter 필수 키 보존(type/resource verbatim, tags는 union)
  assertFrontmatterPreserved(before.fm, after.fm);
}
```

---

## 6. 요약 — 이 문서에서 즉시 채용할 것

| 채용 항목 | 슬롯 | 효과 |
| :--- | :--- | :--- |
| WKF 개념 문서 표준 템플릿(§1) | Phase 5 | 자유형식 MD → 일관 구조 |
| `references/` 1급 출처(§2) | Phase 5~7 | 출처 추적 폐곡선 |
| **Recipe(재현 가능 생성)(§3)** | Phase 6~7 | 재생성·감사·C 연계 |
| `index.md` 자동 생성(§4) | Phase 6 | 문서 트리 = 파일시스템 |
| **비축소 적합성 테스트(§5)** | Phase 5~7 | **재작성 가드레일을 CI로 강제** |

→ 에이전트·하니스 측 구현 스펙은 [`08`](./08-agent-implementation-specs.md)(러너·discovery)·[`09`](./09-enrichment-harness-and-mdcode.md)(하니스·동기화) 참조.
