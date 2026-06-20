# 09. Enrichment 하니스 & Metadata-as-Code 동기화 (Harness & Sync — 구현 스펙)

> `toolbox/enrichment`·`agents/enrichment`·`toolbox/mdcode`·`agents/mdcode`를 코드 레벨로 분석해, **설정 주도 enrichment 하니스**와 **git↔서비스 동기화 프로토콜(낙관적 락)** 을 WekiFlow 구현 스펙으로 옮긴다.
> [`06`](../../archive/okf-knowledge-standard/06-adoptable-patterns.md)에서 식별한 mdcode·하니스를 *실제 매니페스트/CLI/스키마* 수준으로 구체화.

---

# A. Enrichment 하니스 — 설정 주도 지식 생산/진화/유지

원본은 *produce / evolve / maintain* 3국면을 명확히 분리한다. 이게 우리 파이프라인 A(생산)·C(유지)의 운영 모델 레퍼런스다.

## A.1 매니페스트 — `catalog.yaml` (verbatim)

```yaml
scope: bq-dataset.my-project-id.my-dataset-id
snapshot:                       # 로컬로 가져올 범위
  entries: [dataplex-types.global.bigquery-table]
  aspects: [..global.schema, ..global.overview, ..global.queries]
  entryLinks: [definition, synonym]
publishing:                     # 서비스로 내보낼 범위(스냅샷의 부분집합)
  aspects: [..global.overview, ..global.queries]
  entryLinks: [definition]
reference:                      # 읽기전용 그라운딩 베이스라인
  scope: bq-dataset.my-project-id.my-dataset-id
  snapshot:
    aspects: [..global.schema]
```

**설계 통찰(채용):**
- **snapshot ≠ publishing:** *가져오는 범위*와 *발행하는 범위*를 분리 — 일부는 그라운딩용으로만 읽고 쓰진 않음.
- **reference 블록:** 읽기전용 베이스라인을 명시적 선언([`06` §2]의 `.ref` 근거).
- **entryLinks**(`definition`/`synonym`/`related`) = 우리 `# Relations` 술어와 동형.

## A.2 enrichment 에이전트 — 모드 & 멀티소스 (verbatim 플래그)

```bash
agent_runner.py \
  --mode=table|doc|context_overlay \      # 자산문서화 / 문서크롤(map-reduce) / 컨텍스트오버레이
  --dataset=... --entry_group=... \
  --folders=<drive> --docs=<url> \        # 멀티소스 인입
  --repo=owner/name --confluence_space=... --sharepoint_sites=... \
  --topic="<지시>" --model=gemini-2.5-pro \
  --interactive --refine_instruction="..." \   # 대화형 정제(REPL)
  --include_usage=true --usage_window_days=30 \ # 실사용 쿼리이력 반영
  --glossaries=... --output_format=kcmd|okf
```

**채용 가치 큰 메커니즘:**
1. **멀티소스 인입** — Drive·로컬MD·Confluence·SharePoint·GitHub(MCP 경유). → 우리 "🔗 데이터 소스"를 커넥터로 일반화(PRD §4).
2. **`--interactive` 정제(evolve)** — 실행 후 REPL/`refine_instruction`로 *문서를 다시 읽지 않고* 기존 컨텍스트 재사용해 보정. 세션은 `refine_session.json`에 영속(entry_id·grounding_prompt·refinement_history). → 검토자가 Diff 화면에서 "이 부분만 이렇게 고쳐줘"를 거는 **대화형 보정 루프**.
3. **`--include_usage`(usage_window_days)** — 실사용 쿼리 이력을 반영해 무엇을 문서화할지 우선순위화. → 우리는 **`jobs.agentSteps`의 검색 빈도**로 대체(많이 찾는데 약한 문서를 우선 보강) — [`08` Learner]와 연결.
4. **map-reduce 문서 모드** — 큰 문서를 map→reduce→summarize→enumerate→write. → 우리 트리플/요약 추출의 청크 처리와 정합.

## A.3 produce / evolve / maintain → WekiFlow 파이프라인 매핑

| 국면 | 원본 | WekiFlow |
| :--- | :--- | :--- |
| **Produce** | `init`+`pull`(베이스라인) → 소스 인입 → LLM 합성 → 로컬 트리 | **파이프라인 A**(인입→검색→병합) |
| **Evolve** | `--interactive`/`refine` REPL, 컨텍스트 재사용 | **검토 화면의 대화형 보정**(신규: Monaco Diff + "이 부분 고쳐") |
| **Maintain** | 사용자가 명시적 `push`(자동 아님) + 충돌 재조정 | **승인 게이트 + 파이프라인 C**(신선도 재검증) |

> **Maintain은 절대 자동 발행 아님** — 항상 사람의 명시적 행위. 우리 승인 게이트 철학과 동일([`02` §2 우위]).

## A.4 WekiFlow 하니스 스펙

- **`wkf.yaml`(매니페스트):** `scope`(번들 경로) + `sources`(커넥터 목록) + `snapshot`/`publishing` 분리 + `reference`(읽기전용) + `policy.yaml` 참조. → [`07` §3] recipe와 통합 가능(recipe = 실행 단위, manifest = 범위/정책).
- **커넥터 인터페이스:** `Source { list(); fetch(ref): text }` — upload/datasource/manual(기존) + confluence/gdrive/github(확장).
- **대화형 보정:** 검토 세션을 `review_session`(MongoDB)에 영속, 컨텍스트 재사용.

---

# B. Metadata-as-Code 동기화 — 낙관적 락 프로토콜 (★ SoT 역전의 핵심)

[`06` §1]에서 식별한 mdcode 동기화를 *명령·스키마* 수준으로 확정. **우리 `wkf` CLI가 그대로 베낄 프로토콜.**

## B.1 CLI (verbatim) → `wkf` 대응

| `kcmd` | 동작 | `wkf` 대응 |
| :--- | :--- | :--- |
| `init --bigquery-dataset ...` | 매니페스트/스냅샷 초기화 | `wkf init` |
| `pull` | 서비스→로컬, **미반영 변경 시 충돌 보고** | `wkf pull`(DB→번들) |
| `reference` | **읽기전용** 베이스라인(`.ref.yaml`) pull | `wkf reference`(그라운딩) |
| `push [--force] [--validate-only] [--format okf]` | 로컬→서비스, **마지막 pull 이후 변경분만 & 그 사이 원본 미변경 시에만** | `wkf push`(번들→DB+reindex) |
| `status` | 로컬 변경 탐지 | `wkf status` |
| `mcp --path ...` | MCP 서버 | `wkf mcp` |

`--validate-only`(=`--dry-run`), `--format okf`(OKF 번들 출력)도 채용.

## B.2 낙관적 락 (Optimistic Locking) — 동시편집 클로버 방지

> *"push는 마지막 pull 이후의 변경분만 보내고, 그 사이 카탈로그에서 해당 메타데이터가 수정되지 않았을 때만 성공"* + "Safe Push Reconciliation: 정규화 타깃 매칭 + 변경 없는 관계 보존".

이게 [`03` §8]에서 막연했던 "멱등 보장"의 **정확한 구현**이다:

```ts
// 각 개념에 baseRev(마지막 pull 시점의 content hash) 보관
async function wkfPush(concept) {
  const remote = await db.getConcept(concept.slug);
  if (remote.contentHash !== concept.baseRev && !force)
    throw new Conflict(`${concept.slug}: pull 이후 서버가 변경됨`);  // 클로버 방지
  await db.upsert({ ...concept, contentHash: hash(concept), baseRev: undefined });
  await reindexConcept(concept);   // # Relations → kg_*, 본문 → chunks
}
```

- **사람(Monaco 편집) vs 에이전트(파이프라인 A/C) 동시 수정**이 서로를 덮어쓰지 않음 → git 머지/검토로 해소.
- `--force`는 명시적 오버라이드(관리자만).

## B.3 엔트리 스키마 (verbatim) → WKF 매핑

원본 엔트리 YAML + 사이드카 MD:
```yaml
name: bigquery/proj/ds/table
type: dataplex-types.global.bigquery-table
resource: { name, displayName, description, ancestors[], createTime, updateTime }
aspects:
  schema: { fields: [{ name, dataType, mode, links: { definition: [...] } }] }
links: { related: [{ target }] }
```
```markdown
<!-- table.overview.md (사이드카) -->
# Overview ...
## Common Queries ...
## Related Tables - [customers](../customers.md)
```

**WKF는 이를 단순화:** *정형 메타는 frontmatter, 서술/스키마/관계는 본문 섹션*으로 통합(별도 `.aspect.md` 사이드카 불필요 — 우리 문서는 본래 MD 한 파일). 단 **`links.definition`/`related` = `# Relations` 술어**, **`resource.ancestors` = 디렉터리 트리**로 직매핑.

## B.4 MCP 서버 — 지식의 표준 노출면

원본은 CLI 외 **MCP 서버**로 에이전트가 "list, lookup, modify autonomously" 하게 한다.
- WKF 채용: `wkf mcp`가 번들을 MCP로 노출 → 외부 에이전트/IDE(Claude Code 등)가 조직 지식을 **읽기**(우선)·제안. 쓰기는 검토 게이트 뒤. → [`06` §5], 슬롯 Phase 7+.

---

## C. GCP 종속 vs 우리가 가져갈 것 (정리)

| 버릴 것(GCP/Dataplex 종속) | 우리 대체 |
| :--- | :--- |
| `dataplex-types.global.*` 엔트리/애스펙트 타입 | WKF `type` 어휘([`04` §3.3]) |
| Dataplex 엔트리 그룹/글로서리/BigQuery JOBS 이력 | MongoDB 컬렉션 + `jobs.agentSteps` 사용빈도 |
| Vertex AI 추론/리랭크, gcloud ADC | 자체 모델 + `cosineSimilarity` + RRF |
| `kcmd` 구현 자체 | `wkf` CLI(프로토콜만 차용) |

| 가져갈 것(generic) | 슬롯 |
| :--- | :--- |
| **낙관적 락 동기화**(status/pull/push/reference) | Phase 6 |
| snapshot≠publishing 범위 분리, reference 베이스라인 | Phase 6~7 |
| produce/evolve/maintain 운영 모델 + 대화형 보정 | Phase 5~7 |
| 멀티소스 커넥터(Drive/Confluence/GitHub via MCP) | Phase 7+ |
| `--validate-only`/`--format okf`, MCP 노출 | Phase 6~7 |

---

## D. 한 줄 요약

> enrichment 하니스는 우리 파이프라인 A/C의 **운영 모델(produce/evolve/maintain·대화형 보정·멀티소스·사용빈도 우선순위)** 을, mdcode는 SoT 역전의 **동기화 프로토콜(낙관적 락·reference 베이스라인·MCP 노출)** 을 *구체적 명령·스키마* 수준으로 제공한다. GCP 종속부는 버리고, 프로토콜·운영모델·매니페스트 구조는 `wkf` CLI/`wkf.yaml`로 그대로 재구현한다.
