# 05. 큐레이션 에이전트 — 주기적 순회·재검증·갱신 (Pipeline C Design)

> 사용자 고민: *"주기적으로 에이전트가 순회하며 정보를 갱신·재작성하는" 부분이 쓸만한가, 레퍼런스 구현이 있나?*
> 결론: **쓸만하다. 레퍼런스 구현이 검토 중인 저장소 안에 있다** — `okf/src/enrichment_agent`. 본 문서는 그 실제 코드를 분석하고, WekiFlow 파이프라인 C로 이식하는 설계를 정리한다.
> 출처: [knowledge-catalog/okf/src/enrichment_agent](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf/src/enrichment_agent) (Google ADK 기반).

---

## 1. 한 줄 결론

> **"매주 다시 쓰는 에이전트"가 아니라, "신선도 SLA가 지난 개념만 / 원문이 실제로 바뀌었을 때만 / 헤딩 구조를 보존하며 가산적(additive)으로 / 사람 승인 하에" 갱신하는 에이전트로 설계하면 안전하고 강력하다.** 성패는 *재작성 가드레일*에 달려 있고, OKF가 검증된 가드레일을 그대로 제공한다.

---

## 2. 레퍼런스 분석 — OKF `enrichment_agent`

### 2.1 구조

Google ADK 기반, **2-pass** 에이전트:

| 파일/디렉터리 | 역할 |
| :--- | :--- |
| `agent.py` | `build_bq_agent`(씨앗 생성) / `build_web_agent`(외부 보강) 정의. 모델 `gemini-flash-latest`. |
| `runner.py` | 2-pass 오케스트레이션. **선형·1회·재시도 없음.** |
| `prompts/*.md` | enhance/create/skip 의사결정·가드레일이 **외부 프롬프트 텍스트**로 분리 (교체 가능한 정책 계약) |
| `tools/` | `fetch_url`(크롤) 등. **한도를 도구 레이어에서 강제.** |
| `sources/` | BigQuery 등 소스 연결 |

도구 셋:
- `list_concepts` — 기존 개념 순회(인벤토리)
- `read_concept_raw` / `read_existing_doc` — 기존 지식 읽기
- `write_concept_doc` — 생성/갱신 쓰기
- `fetch_url` — (web agent 전용) 외부 페이지 크롤

### 2.2 핵심 ① — 항목마다 3-way 결정 (enhance / create / skip)

각 페이지(또는 개념)마다 에이전트가 셋 중 하나를 택한다. **디폴트는 skip** ("When in doubt, skip").

- **Enhance(기존 보강):** 기존 개념이 다루는 주제면 `read_existing_doc()` → `write_concept_doc()`로 *가산적* 보강.
- **Create(신규 reference):** 아래 4조건을 **모두** 만족할 때만:
  1. **형태(Topic shape):** 이름으로 참조 가능한 실체(엔티티/지표/enum/필드 용어/가격 노트/관례)
  2. **메타 아님:** 개요·소개·튜토리얼·체인지로그·FAQ 제외
  3. **인용 테스트:** "X 레퍼런스를 보라" 같은 구체 명사 문장이 성립
  4. **재사용 테스트:** 2개 이상 개념이 이득을 보거나, 한 개념의 핵심 배경이 됨
- **Skip:** 무관·저신호·이미 충분히 커버됨.

### 2.3 핵심 ② — 재작성 가드레일 (★ "비협상" 규칙)

> 사용자 고민의 핵심("재작성")에 대한 직접적 답. 이 규칙이 **파괴적 재작성/드리프트를 원천 차단**한다.

기존 문서를 보강할 때 다음은 **non-negotiable**:

1. **Frontmatter 보존:** 기존 키를 **전부** 포함. `type/title/resource`는 **그대로(verbatim)**, `tags`는 **합집합(union)**, `timestamp`는 갱신.
2. **본문 구조 보존:** *"기존 본문의 모든 `#` 헤딩이 같은 순서·같은 문구로 다시 나타나야 한다."*
   - ✅ 허용: 산문 확장, 불릿 추가, 새 하위섹션, 인용 append
   - ❌ 금지: **헤딩 삭제, 통째 재작성(wholesale rewrite), 스키마 섹션 축소**
3. **주제 이탈 시:** 억지 병합 금지 → 새 reference로 분리하거나 skip.

### 2.4 핵심 ③ — 에이전트는 스스로 스케줄하지 않는다

- `runner`는 개념을 **한 번씩 순차 처리**, 루프·재시도 없음. Web pass도 **1회 실행**.
- 페이지 상한(`max_pages`, 기본 100)·홉 깊이(`max_depth`, 기본 2)·허용 호스트(`allowed_hosts`)는 **`fetch_url` 도구가 강제** — "거부된 URL 재시도 금지". 오케스트레이터가 아니라 **도구 레이어가 하드 한도의 주체**.
- **함의:** 스케줄링·반복은 *바깥*(cron/큐)에 둔다. 에이전트는 "1회 순회"만 책임진다 → 폭주 통제 단순화.

### 2.5 핵심 ④ — 출처(Provenance)

실제로 fetch한 URL(또는 문서에 이미 있던 URL)만 인용. **URL 창작 금지.**

---

## 3. 솔직한 평가 — 가치 vs 리스크

| 측면 | 평가 |
| :--- | :--- |
| **가치** | ✅ 높음. "들어온 것만 처리"하는 현 WekiFlow의 최대 약점(시간이 지나 틀려지는 지식)을 메운다. |
| **최대 리스크** | ⚠️ **파괴적 재작성/드리프트** — 잘 쓰인 문서를 주기적으로 "개선"하다 점점 망가뜨림. |
| **검증된 완화** | OKF가 답을 줌: (1) 가산적·구조보존 재작성만, (2) 의심되면 skip, (3) 한도는 도구 레이어 하드 강제, (4) 변경은 사람 검토 게이트 통과. |
| **WekiFlow 추가 우위** | **샌드박스 grep 재검증** — OKF는 LLM 크롤·요약에 의존하지만, 우리는 "재작성 전에 원문 팩트가 실제로 바뀌었는지" 결정론적으로 확인할 수 있다(OKF보다 한 단계 강함). |

---

## 4. WekiFlow 이식 설계 (파이프라인 C)

> OKF agent는 Python/ADK·BigQuery 중심이라 **드롭인 불가, 설계 레퍼런스**. 우리 스택(TS/Vercel AI SDK/BullMQ/MongoDB)으로 매핑한다.

### 4.1 매핑표

| OKF enrichment_agent | WekiFlow 파이프라인 C |
| :--- | :--- |
| 외부 스케줄(수동) | **BullMQ repeatable job (cron)** — 신설 |
| `list_concepts` 순회 | `wkf scanStale(policy)` — 신선도 SLA 초과 개념만 큐잉([`04` §8](./04-wekiflow-knowledge-spec.md)) |
| `read_existing_doc` / `write_concept_doc` | `wkf parse` / `wkf serialize` (번들 = SoT) |
| `fetch_url` + allowlist | 동일 + `policy.yaml`의 `allowed_hosts` · `web_max_pages`([`04` §5](./04-wekiflow-knowledge-spec.md)) |
| enhance/create/skip 프롬프트 | **거의 그대로 차용** (검증된 프롬프트) |
| 재작성 가드레일(§2.3) | **그대로 채택** → 파이프라인 C 병합 정책 |
| (검증 없음) | **+ `tool_execute_sandbox_terminal` grep 재검증** (우리 우위) |
| (검토 없음) | **+ Monaco Diff 사람 승인 게이트** (우리 우위) |
| 에이전트 루프 | Vercel AI SDK `ToolLoopAgent` (이미 보유, `docs/22`) |

### 4.2 파이프라인 C 흐름 (가드레일 반영)

```
[1] cron 트리거 (BullMQ repeatable: 예) 매일 03:00)
        │
[2] scanStale(policy) : type별 freshness SLA 초과 개념 선별
        │   예) REGULATION=90d 초과 → 큐잉.  (전수 순회 아님 = 비용·드리프트 통제)
        ▼
[3] 개념별 ToolLoopAgent 1회 실행 (재시도·자율 반복 없음 — OKF 철학)
        ├─ (사내) tool_execute_sandbox_terminal: 원문 grep 재확인
        │         → 원문 팩트 변동 없음? → write 안 함, last_verified만 갱신
        │         → 변동 있음? ↓
        ├─ (외부·정책 허용 시) fetch_url(allowlist, max_pages 도구레이어 강제)
        └─ 3-way 결정: enhance(가산·구조보존) / create(4조건) / skip(디폴트)
        │
[4] 변경 발생 시 : tool_merge(가드레일 적용) → status=REVIEW
        │   (reviewApprovalEnabled=false면 즉시 PUBLISHED — docs/13)
        ▼
[5] 사람 승인 → 번들 커밋 → log.md에 **Update**/**Verify** 1줄 → wkf reindex
```

> **변경 없음도 1급 결과:** 원문이 안 바뀌었으면 `last_verified`(frontmatter)와 `log.md`의 `**Verify**`만 갱신. → "오래됐지만 여전히 맞는 지식"과 "오래되고 틀린 지식"을 구분.

### 4.3 `ToolLoopAgent` 골격 (의사코드)

```ts
// workers/curation/src/pipeline.ts (신설)
const curationAgent = new ToolLoopAgent({
  model: openai(env.AGENT_MODEL),
  instructions: CURATION_SYSTEM_PROMPT,   // §4.4 — OKF 가드레일 차용
  tools: {
    toolReadConcept,            // wkf parse
    toolGrepVerify,             // tool_execute_sandbox_terminal(원문 재확인)
    toolFetchUrl,               // allowlist + max_pages (도구레이어 하드 강제)
    toolWriteConcept,           // wkf serialize + 가드레일 검증(write 시 거부)
  },
  stopWhen: stepCountIs(policy.enrichment.agent_step_limit), // 기본 12
});

// 스케줄: BullMQ repeatable
curationQueue.add('scan', {}, { repeat: { pattern: '0 3 * * *' } });
// 잡 핸들러: const stale = await wkf.scanStale(bundle, policy);
//            for (const c of stale) await curationAgent.generate({ prompt: buildCurationPrompt(c) });
```

> `toolWriteConcept`는 쓰기 **직전** §2.3 가드레일(헤딩 보존·frontmatter 전 키 포함)을 검증하고, 위반 시 **거부**한다 — "지키면 좋은 가이드"가 아니라 "어기면 막히는 계약"(OKF 철학).

### 4.4 큐레이션 시스템 프롬프트 (차용 요지)

```
너는 지식 큐레이터다. 주어진 개념 문서를 최신·정확하게 유지하되, 절대 파괴하지 않는다.

[원칙]
1. 먼저 원문을 grep으로 재확인하라. 팩트가 그대로면 갱신하지 말고 "변경 없음"을 반환하라.
2. 갱신이 필요하면 가산적(additive)으로만 하라:
   - 기존 frontmatter 키는 전부 보존(type/title/resource는 그대로, tags는 합집합).
   - 기존 본문의 모든 # 헤딩을 같은 순서·문구로 유지하라. 헤딩 삭제·통째 재작성·스키마 축소 금지.
3. 주제가 근본적으로 다르면 보강하지 말고 새 reference로 분리하거나 skip하라.
4. 의심되면 skip하라.
5. 실제로 확인/fetch한 출처만 # Citations에 인용하라. URL을 창작하지 마라.
```

---

## 5. policy.yaml 연동 (큐레이션 관련 키)

[`04` §5](./04-wekiflow-knowledge-spec.md)의 `policy.yaml`에서 파이프라인 C가 소비하는 항목:

```yaml
freshness:                    # [3] 무엇을 언제 재검증할지
  REGULATION: 90d
  default: 365d
sources:
  allowed_hosts: [intra.example.com, law.go.kr]   # [도구레이어 강제]
enrichment:
  web_max_pages: 50           # [도구레이어 강제 — OKF처럼 fetch_url가 책임]
  agent_step_limit: 12        # [stopWhen]
```

> **한도의 주체는 도구다.** `web_max_pages`·`allowed_hosts`는 에이전트 프롬프트가 아니라 `toolFetchUrl` 구현이 강제한다. 프롬프트는 의도를, 도구는 한도를 책임진다 — OKF의 검증된 분리.

---

## 6. 도입 위치 (로드맵)

[`03` §7](./03-proposal.md)의 **Phase 7(정책 + 지속 업데이트)** 에 포함된다. 선행 조건:
- Phase 5(WKF 스펙·`wkf validate`·`parse`/`serialize`)
- Phase 6(SoT 역전·`wkf reindex`) — `scanStale`가 번들을 읽으려면 번들이 SoT여야 효과적.

**최소 PoC(Phase 6 없이도 가능):** 사내 grep 재검증만 하는 축소판 — cron + `scanStale`(DB의 `updatedAt` 기준) + grep + REVIEW 큐. 외부 크롤·가드레일 풀셋은 이후 확장.

---

## 7. 요약

| 질문 | 답 |
| :--- | :--- |
| 주기적 순회·갱신 에이전트, 쓸만한가? | ✅ 쓸만하다 = 파이프라인 C. 현 구조의 최대 약점을 메운다. |
| 레퍼런스 예시 있나? | ✅ `okf/src/enrichment_agent` (Google ADK). 본 문서가 분석·이식 설계 제공. |
| 재작성이 위험하지 않나? | OKF의 **가산적·구조보존 가드레일 + 의심되면 skip + 도구레이어 한도 + 사람 검토**로 통제. 우리는 **grep 재검증**까지 더해 더 안전. |
| 그대로 쓸 수 있나? | ❌ Python/ADK라 드롭인 불가. ✅ 설계·프롬프트·가드레일은 차용, 우리 TS/AI SDK/BullMQ 스택으로 재구현. |
