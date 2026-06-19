# PR-02 — parse / serialize + `fromMongo` 어댑터 + 라운드트립 테스트

> Phase 5 · 선행: PR-01 · 근거: [`04` §8](../04-wekiflow-knowledge-spec.md), [`07` §5](../07-knowledge-format-and-generation.md)

## 목표
WKF 문서(MD)와 구조체 사이의 무손실 변환을 구현한다. SoT 역전의 안전성은 **parse↔serialize 라운드트립 보존**으로 증명된다.

## 범위
- **In:** `parse(md)`, `serialize(doc)`, `fromMongo(mongoDoc)`, `# Relations`/`# Citations` 섹션 파서, 라운드트립 테스트.
- **Out:** 적합성 검증(PR-03), DB 동기화(PR-04/05).

## 변경 파일
- 🆕 `packages/wkf/src/parse.ts`, `serialize.ts`, `sections.ts`(섹션 파서), `fromMongo.ts`
- 🆕 `packages/wkf/src/*.test.ts`
- 📦 `gray-matter`(또는 자체 `---` 파서) + `yaml`

## 구현 단계
1. `parse(md)`: frontmatter(`---`) 분리 → `FrontmatterSchema.parse` → `{ frontmatter, body }`.
2. `serialize(doc)`: frontmatter를 안정적 키 순서로 YAML 직렬화 + body 결합. **키 순서·리스트 보존**.
3. `sections.ts`:
   - `parseRelations(body): Triplet[]` — `(S) -[P]-> (O) {strength, ref}` 라인 파싱.
   - `serializeRelations(triplets): string`.
   - `parseCitations`/`extractHeadings`(PR-03 비축소용 헤딩 추출 헬퍼).
4. `fromMongo(doc)`: `documents` 스키마([`03`](../../03-data-model.md)) → `WkfDoc`(contentMarkdown→body, title/slug/status→frontmatter, sourceRefs→`# Citations`).

## 테스트
- **라운드트립:** 샘플 MD 10종 → `serialize(parse(md))` 가 의미 보존(frontmatter 키/값, 본문 헤딩, `# Relations` 트리플).
- `parseRelations`: strength/ref 옵션 유무 모두.
- `fromMongo`: 기존 문서가 유효 WKF로 변환.

## DoD
- [ ] 라운드트립 테스트 green(10/10).
- [ ] `# Relations` 트리플이 파싱/재직렬화 후 동일.
- [ ] 기존 PUBLISHED 문서가 `fromMongo`로 손실 없이 변환.

## 리스크·메모
- YAML 멀티라인/유니코드(한글) 보존 주의 — `yaml` 라이브러리 기본 설정 점검.
- 라운드트립은 SoT 역전 게이트의 핵심 증거([`10` §2.2 DoD]).
