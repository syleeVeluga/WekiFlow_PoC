# PR-29 — Source Connector 인터페이스 (구조·mock) (T2/T3 공통 기반)

> Track T2/T3 공통 · 상태: 계획 · 선행: [PR-26](./PR-26-candidate-contract.md) · 근거: [`Overview.md`](./Overview.md) §3.1(범용 Source 모델), [`Gap-Analysis.md`](./Gap-Analysis.md) §2.3·§2.7
> **외부 API 메모: 본 PR이 사용자 요청의 핵심.** Slack/Drive/회의록 등 외부 API 연결은 **구조와 기능 인터페이스만** 가져간다. 실제 API 호출은 mock/stub로 두고, 라이브 인증·네트워크 테스트는 범위 밖.

## 목표

BigQuery 같은 특정 소스에 묶이지 않은 **범용 `Source` 커넥터 인터페이스**를 정의한다. Overview §3.1의 `Source { list(); fetch(ref): text }` 모델을 구현하고, Slack·Google Drive·회의록(meeting transcript)용 어댑터를 **구조만** 제공한다. 실제 외부 호출 자리는 mock adapter로 채워 후속 PR(28 인입, 30 대화 인입)이 동일 인터페이스로 동작하도록 한다.

## 범위

- **In:**
  - `SourceConnector` 인터페이스(`list()`, `fetch(ref)`, `kind`, capability 메타).
  - Slack / Google Drive / Meeting / Upload / URL 어댑터의 **타입·시그니처·구조**.
  - mock 어댑터 구현(고정 샘플 데이터 반환) + connector registry.
  - 커넥터 설정(자격증명 placeholder) 스키마 — 값은 비우고 구조만.
- **Out:** 실제 OAuth/토큰 교환, 라이브 API 호출, rate-limit·webhook 처리(모두 TODO 주석으로 자리만), 인입 파이프라인 연결(→ PR-28/30).

## 변경 파일

- 🆕 `packages/connectors/src/types.ts` — `SourceConnector`, `SourceRef`, `SourceItem`, `ConnectorCapability`, `ConnectorConfigSchema`.
- 🆕 `packages/connectors/src/registry.ts` — `getConnector(kind)`, 등록 맵.
- 🆕 `packages/connectors/src/adapters/slack.ts` — 구조 + mock(`listChannels`/`listMessages`/`fetchThread`). 실제 호출부는 `// TODO: live Slack Web API` 주석.
- 🆕 `packages/connectors/src/adapters/googleDrive.ts` — 구조 + mock(`listFiles`/`fetchFile`).
- 🆕 `packages/connectors/src/adapters/meeting.ts` — 구조 + mock(transcript 파싱 인터페이스).
- 🆕 `packages/connectors/src/adapters/{upload,url}.ts` — 기존 인입을 동일 인터페이스로 감싸는 어댑터.
- 🔧 `.env.example` — 커넥터 자격증명 placeholder 키(빈 값) 추가.

## 구현 단계

1. **인터페이스 정의.** `SourceConnector { kind; capabilities; list(opts): Promise<SourceItem[]>; fetch(ref): Promise<{text; metadata; provenanceKind}> }`. `provenanceKind`는 PR-26 provenance와 연결(slack/drive→`datasource` 또는 `conversation`).
2. **registry.** kind→connector 매핑. 미구현 kind는 명시적 `NotImplemented` 대신 mock 반환.
3. **Slack 어댑터(구조).** 채널/메시지/스레드 모델과 메서드 시그니처 정의. 본문은 고정 샘플 스레드 반환. 인증·페이지네이션·rate-limit은 타입과 TODO 주석으로 자리만.
4. **Drive/Meeting 어댑터(구조).** 동일 패턴. Drive는 파일 메타+텍스트, Meeting은 발화자별 transcript 세그먼트(`speaker`, `quote`) — PR-26 대화 provenance와 정합.
5. **Upload/URL 어댑터.** 기존 파일 업로드·URL fetch를 `SourceConnector`로 래핑해 인입 경로 통일.
6. **config 스키마.** `ConnectorConfigSchema`에 자격증명 필드 정의(token/clientId 등). `.env.example`에 빈 placeholder만 추가, 실제 값 없음.

## 테스트

- registry: kind별 connector 반환, 미지원 kind 처리.
- mock 어댑터: `list()`/`fetch()`가 고정 샘플을 contract 형태로 반환.
- provenanceKind 매핑: slack/meeting → 대화 provenance 필드 채움.
- (라이브 API 테스트는 범위 밖 — mock 단위 테스트만.)

## DoD

- [ ] 범용 `SourceConnector` 인터페이스가 정의되고 registry로 조회된다.
- [ ] Slack/Drive/Meeting/Upload/URL 어댑터가 동일 인터페이스를 구현한다(외부는 mock).
- [ ] mock 데이터로 후속 인입 PR이 end-to-end로 돌 수 있다.
- [ ] 실제 자격증명/네트워크 없이 빌드·테스트가 통과한다.

## 리스크·메모

- **의도적 제약:** 라이브 API 미연결. 실제 연동은 별도 후속 PR(인증·webhook·rate-limit)로 분리하며, 본 PR은 그 자리를 타입과 TODO로 확보.
- mock 데이터는 데모·E2E 픽스처로 재사용하므로 현실적인 샘플로 작성.
- 자격증명은 절대 커밋하지 않음 — `.env.example`은 빈 placeholder만.
