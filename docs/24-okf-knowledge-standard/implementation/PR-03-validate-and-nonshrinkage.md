# PR-03 — `validate`(적합성) + 비축소(non-shrinkage) 검증 라이브러리

> Phase 5 · 선행: PR-02 · 근거: [`07` §5](../07-knowledge-format-and-generation.md), [`05` §2.3](../05-curation-agent.md)

## 목표
번들/문서 적합성 게이트와, 재작성이 지식을 *축소*하지 못하게 하는 **비축소 어서션**을 라이브러리로 제공한다. 이 lib는 PR-12(쓰기 강제)·PR-09(커밋 게이트)에서 재사용된다.

## 범위
- **In:** `validate(bundle, policy?)`, `assertNoShrinkage(before, after)`, 헤딩/스키마/인용 카운트 헬퍼, 테스트.
- **Out:** policy.yaml 로더(PR-09는 이 lib를 호출), 쓰기 경로 연결(PR-12).

## 변경 파일
- 🆕 `packages/wkf/src/validate.ts`, `guardrails.ts`
- 🆕 `packages/wkf/src/*.test.ts`

## 구현 단계
1. `validate(bundle)` — OKF MUST 채용([`07` §5]):
   - 모든 비예약 `.md`에 파싱 가능 frontmatter + 비어있지 않은 `type`.
   - 예약 파일(`index.md`/`log.md`/`policy.yaml`) 구조 점검.
   - `policy.citations.required_for` type은 `# Citations` 보유.
   - **소비자 관용:** 누락 권장필드·모르는 type·깨진 링크로 reject 금지(경고만).
2. `assertNoShrinkage(before, after)`:
   ```ts
   assertHeadingsPreserved(before.body, after.body);   // 모든 # 헤딩 순서·문구 보존
   assert(schemaFieldCount(after) >= schemaFieldCount(before));
   assert(citationCount(after) >= citationCount(before));
   assertFrontmatterPreserved(before.fm, after.fm);     // type/resource verbatim, tags union
   ```
3. 위반 시 구조화된 `ValidationError`(어떤 규칙/어디) 반환.

## 테스트
- 적합성: type 누락 reject, 깨진 링크 허용(경고), citations 필수 type 누락 시 fail.
- 비축소: 헤딩 삭제/스키마 필드 감소/인용 감소 → 각각 throw. 가산적 변경(섹션 추가) → pass. `tags` union 유지.

## DoD
- [ ] `validate`가 OKF MUST를 정확히 강제하고 관용 규칙을 지킨다.
- [ ] `assertNoShrinkage`가 4종 축소를 모두 차단, 가산 변경은 통과.
- [ ] 라이브러리가 PR-09/PR-12에서 import 가능하게 export.

## 리스크·메모
- 헤딩 "같은 문구" 비교는 정규화(trim/공백) 후 비교 — 과민하면 정상 보강을 막음.
- 이 PR이 "재작성 가드레일을 CI로 강제"의 핵심([`10` §3.2 DoD]).
