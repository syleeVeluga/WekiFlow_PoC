# PR-05 — `wkf push`(낙관적 락) + `wkf reference`(읽기전용)

> Phase 5 · 선행: PR-03, PR-04 · 근거: [`09` §B.2](../09-enrichment-harness-and-mdcode.md), [`06` §1·§2](../06-adoptable-patterns.md)

## 목표
번들의 로컬 변경을 DB로 반영하되, **마지막 pull 이후 변경분만 & 그 사이 원본이 안 바뀐 경우에만** 성공하는 낙관적 락을 구현(사람 vs 에이전트 동시편집 클로버 방지). 읽기전용 그라운딩(`reference`)도 추가.

## 범위
- **In:** `wkf push [--force] [--validate-only]`, 낙관적 락, `wkf reference`(`.ref` 읽기전용 pull).
- **Out:** reindex 호출은 PR-06 병합 후 push 말미에 연결(이 PR은 DB upsert까지; reindex 훅은 PR-06에서).

## 변경 파일
- 🆕 `packages/wkf/src/sync/push.ts`, `sync/reference.ts`
- 🔧 `packages/wkf/src/cli.ts`

## 구현 단계
1. `wkf push`:
   ```ts
   for (const c of changedConcepts) {
     wkf.validate(c);                                  // PR-03 게이트
     const remote = await db.getConcept(c.slug);
     if (remote && remote.contentHash !== c.baseRev && !force)
       throw new Conflict(`${c.slug}: pull 이후 서버 변경됨`);
     await db.upsert({ ...c, contentHash: hash(c) });   // baseRev 갱신
   }
   ```
2. `--validate-only`(=dry-run): 검증·충돌 검사만, 쓰기 없음.
3. `--force`: 락 무시(ADMIN 전용; 호출부 RBAC는 PR-09/ API에서).
4. `wkf reference`: 지정 개념의 현재 published 본문을 **읽기전용 `.ref`** 로 가져옴(PR-11 큐레이션 그라운딩 입력).

## 테스트
- 정상 push: baseRev 일치 → upsert + contentHash 갱신.
- 충돌: pull 이후 DB 변경 시 `Conflict` throw, `--force`면 통과.
- `--validate-only`: DB 무변경.
- `reference`: `.ref`가 읽기전용 표식.

## DoD
- [ ] 동시편집 시나리오(사람·에이전트)에서 클로버가 차단된다.
- [ ] `--validate-only`/`--force` 동작.
- [ ] `wkf reference`가 읽기전용 베이스라인을 만든다.

## 리스크·메모
- 락 단위는 개념(파일) 단위. 디렉터리 일괄 push 시 부분 실패 처리(성공분 커밋 + 충돌분 보고).
- 이 PR이 [`10` §0 결정 #5]의 구현체.
