# 구현 계획 — PR 시퀀스 인덱스 (Implementation Plan Index)

> [통합 실행 계획서](../10-consolidated-execution-plan.md)의 Phase 5~7을 **PR 단위**로 전개한다. 각 PR은 독립 리뷰·머지 가능한 최소 단위이며, 선행 PR이 머지된 뒤 착수한다.
> 작업 근거(설계)는 상위 폴더 `01~09`, 실행 기준은 `10`을 따른다.

---

## PR 문서 규약 (Template)

각 PR 문서는 다음 절을 가진다: **목표 / 범위(In·Out) / 선행 / 변경 파일 / 구현 단계 / 테스트 / 완료 기준(DoD) / 리스크·메모**.

공통 규약:
- 스택: Node 24 LTS · TS strict ESM(`NodeNext`) · `ai@6`(`ToolLoopAgent`, `instructions`, `inputSchema`/`outputSchema` zod) · `bullmq@5` · `mongodb@6` · `dockerode@5`.
- 테스트: `vitest`. LLM은 `ai/test`의 `MockLanguageModelV3` + **`mockValues(...)`**(배열 직접 전달 시 off-by-one 주의, [`docs/13`](../../13-implementation-decisions.md)).
- CI 게이트: **`pnpm -r build` → `pnpm -r typecheck` → `pnpm -r test`** 순서(타입은 빌드된 dist로 해소 — [memory: typecheck-needs-build-first]).
- 각 PR은 green CI로 머지. DoD 미충족 시 머지 금지.

---

## Phase 5 — 지식 표준 + SoT 역전

| PR | 제목 | 선행 | 산출 |
| :--- | :--- | :--- | :--- |
| [PR-01](./PR-01-wkf-scaffold-and-spec.md) | `packages/wkf` 스캐폴드 + WKF v0.1 스펙 + frontmatter 타입 | 완료 | 패키지·SPEC·zod |
| [PR-02](./PR-02-parse-serialize.md) | parse/serialize + `fromMongo` 어댑터 + 라운드트립 테스트 | 완료 | 직렬화 |
| [PR-03](./PR-03-validate-and-nonshrinkage.md) | `validate`(적합성) + **비축소 검증 라이브러리** | 완료 | 게이트·가드레일 lib |
| [PR-04](./PR-04-bundle-init-pull.md) | 번들 레이아웃 + `wkf init/status/pull`(DB→번들, baseRev) | 완료 | export 경로 |
| [PR-05](./PR-05-push-optimistic-lock.md) | `wkf push`(**낙관적 락**) + `wkf reference`(읽기전용) | 완료 | 동기화 |
| [PR-06](./PR-06-reindex.md) | `wkf reindex`(번들→chunks/벡터 + `# Relations`→kg_*) | 02 | 재빌드 |
| [PR-07](./PR-07-graph-emit-relations.md) | `workers/graph` 재배선: 트리플 → `# Relations` 섹션 | 06 | B 변경 |
| [PR-08](./PR-08-index-generation.md) | `wkf index`(자동 `index.md` 생성) | 02 | 트리 네비 |

## Phase 6 — 정책 + 큐레이션 재검증

| PR | 제목 | 선행 | 산출 |
| :--- | :--- | :--- | :--- |
| [PR-09](./PR-09-policy-engine.md) | `policy.yaml` 스키마 + 로더 + 커밋/API 게이트 | 03 | 정책 엔진 |
| [PR-10](./PR-10-curation-worker-scaffold.md) | `workers/curation` 스캐폴드 + repeatable(cron) + `scanStale` | 09 | 파이프라인 C 뼈대 |
| [PR-11](./PR-11-curation-agent.md) | 큐레이션 에이전트(grep 재검증·enhance/create/skip·reference 그라운딩) | 05,10 | C 코어 |
| [PR-12](./PR-12-enforce-nonshrinkage.md) | 쓰기 경로에 **비축소 강제** | 03,11 | 가드레일 강제 |
| [PR-13](./PR-13-log-md.md) | `log.md` 자동 append(A/B/C) | 04 | 변경 이력 |
| [PR-14](./PR-14-recipe-regenerate.md) | (선택) `recipe.yaml` + `wkf regenerate` | 06 | 재현 생성 |

## Phase 7 — 피드백 학습 + 검색 강화

| PR | 제목 | 선행 | 산출 |
| :--- | :--- | :--- | :--- |
| [PR-15](./PR-15-learner-worker.md) | `workers/learner`(파이프라인 D): 궤적 judge → 제안 | 03 | 러너 |
| [PR-16](./PR-16-regression-goldens.md) | `evalCandidate` → 회귀 골든셋 | 15 | 회귀 감지 |
| [PR-17](./PR-17-discovery-decomposition.md) | Discovery 질문분해 + 다중쿼리 + 리랭크 | — | 검색 전처리 |
| [PR-18](./PR-18-discovery-agent-composition.md) | Q&A 에이전트 + `AgentTool` 합성 | 17 | 멀티에이전트 |
| [PR-19](../../okf-pr-19-external-enrichment.md) | (선택) 외부 allowlist 크롤 enrichment | 완료 | 외부 보강 |
| [PR-20](../../okf-pr-20-mcp-and-connectors.md) | (선택) `wkf mcp` + 멀티소스 커넥터 | 완료 | 생태계 |

---

## 의존성 그래프 (요약)

```
PR-01 ─ PR-02 ─┬─ PR-03 ─┬─ PR-05 (← PR-04)
               │         ├─ PR-09 ─ PR-10 ─ PR-11 ─ PR-12
               │         └─ PR-15 ─ PR-16
               ├─ PR-04 ─ PR-05 / PR-13
               ├─ PR-06 ─ PR-07 / PR-14
               └─ PR-08
PR-17 ─ PR-18                 (독립 트랙: 검색 강화)
PR-11 ─ PR-19 ;  PR-05 ─ PR-20   (선택)
```

핵심 임계경로: **01 → 02 → 03 → 05**(표준·검증·동기화) 와 **02 → 06 → 07**(재빌드·그래프). 이 둘이 Phase 5의 게이트(“DB 비우고 reindex로 완전복구”)를 만든다.

## 병렬화 가능 트랙
- 트랙 A(표준·동기화): 01→02→03→04→05
- 트랙 B(재빌드·그래프): 02→06→07, 02→08
- 트랙 C(검색): 17→18 (다른 트랙과 독립, 언제든)
- 트랙 D(정책·큐레이션): 03→09→10→11→12, 04→13
- 트랙 E(러너): 03→15→16

## 범위 표기
🟢 핵심(확정) · 🟡 선택(opt-in: PR-14·19·20). PR-19/20은 완료되어 상위 `docs/archive/` 문서로 보존한다.
