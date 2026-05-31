# 21 — 직접 추가(Direct Add) 페이지 계획

> 좌측 **주제 관리** 사이드바 + **주제 배정** + **내용 입력**(입력 방식 탭)을 결합한 `직접 추가` 페이지를
> 구현한다. 사용자가 주제를 배정하고 제목·부서·내용(직접 입력 또는 파일 업로드)·출처를 입력하면
> **검토 요청하기 →** 로 **실제 검토(REVIEW) 큐에 인입**된다. 입력 방식은 추후 **웹 페이지 크롤링·API·외부 연동**으로
> 확장 가능한 **탭 구조만 잡고**, 이번엔 **직접 입력 + 파일 업로드(PDF·MD·TXT)**만 동작시킨다.
>
> *A Direct-Add page combining a topic-manager sidebar, topic assignment, and a tabbed content-input area.
> Submitting routes into the real REVIEW queue. The input-method tabs are scaffolded for future
> web/API/integration sources; only manual text + file upload (PDF/MD/TXT) are wired now.*

---

## 0. 배경 (Context)

`직접 추가`는 현재 **스텁**이다:

- `activePage === 'add'` → `StubPage`만 렌더 ([apps/web/src/App.tsx:39](../apps/web/src/App.tsx#L39)).
- LNB 네비게이션 `직접 추가` → "준비 중입니다." 토스트 ([apps/web/src/components/lnb/Lnb.tsx:21](../apps/web/src/components/lnb/Lnb.tsx#L21)).
- 조직 지식 상단 `+ 직접 추가` 버튼 → 동일 토스트 ([apps/web/src/components/kb/KbPage.tsx:108](../apps/web/src/components/kb/KbPage.tsx#L108)).

요구: 첨부 목업의 **주제 관리**(기본 제공 주제 포함)를 최대한 준용하고, 주제 배정 영역은 `+ 새 주제`를 기본 노출,
내용 입력은 제목 필수 · 부서는 워크스페이스 목록(부서 열거값) · "P2 배치 검토" 안내는 **미반영**. 파일 업로드는
두 번째 첨부처럼 탭(파일/웹 페이지/직접 입력/외부 연동) 구조로 두되 **파일 업로드만 우선 반영**.

### 확정된 결정 (Locked Decisions)

| 항목 | 결정 | 비고 |
| :--- | :--- | :--- |
| 레이아웃 | **공통 메타 + 탭 본문 교체** | 주제 배정·제목·부서·출처는 항상 표시, 입력 방식 탭이 `내용` 본문 영역만 교체 |
| 제출 동작 | **실제 검토 큐로 인입** | `POST /api/ingest`(직접 입력) + 신규 파일 인입 엔드포인트, 결과 status `REVIEW` |
| 파일 포맷 | **3종 우선 + 6종 노출** | UI엔 PDF/DOCX/PPTX/XLSX/MD/TXT·20MB 표기, 실제 추출은 PDF/MD/TXT. DOCX/PPTX/XLSX 비활성(추후) |
| 부서 목록 | `DepartmentSchema` 열거값 재사용 | `총무팀/인사팀/IT팀/재무팀/영업팀` (`미분류` 제외), 기본값 `총무팀` |
| 주제 배정 | 전체 주제(시스템+사용자, `미분류` 제외) 단일선택 칩 + `+ 새 주제` 칩 **항상 노출** | 인라인 생성→자동 선택 |
| "P2 배치 검토" 안내 박스 | **미반영** | — |

---

## 1. UI 레이아웃

```
section.add-shell
├─ aside.add-topics  ──"주제 관리" 사이드바 (첨부1 좌측 준용)
│   · 헤더 + 안내문("직접 추가한 주제만 여기서 삭제할 수 있습니다 / AI 자동 분류 주제는 태그로 관리됩니다")
│   · "직접 추가한 주제"  → source==='user' 목록(삭제 버튼). 없으면 "아직 직접 추가한 주제가 없습니다"
│   · "기본 제공 주제"    → source==='system' 목록 + count (삭제 불가)
│   · 푸터: [새 주제 이름…] 입력 + [추가]  → createTopic
└─ div.add-main
    · breadcrumb: 조직 지식 › 직접 추가
    ┌ card "주제 배정 * 필수" ───────────────────────────────────────
    │  안내문 + 칩 토글(전체 주제 단일선택) + [+ 새 주제] 칩(인라인 입력 → 생성 → 자동 선택)
    ┌ card "내용 입력" ─────────────────────────────────────────────
    │  제목 *  [예: 법인카드 편의점 사용 기준]
    │  부서 *  [▾ 총무팀 / 인사팀 / IT팀 / 재무팀 / 영업팀]
    │  내용 *  [파일][웹 페이지][직접 입력][외부 연동]   ← 입력 방식 탭 (기본 활성: 파일)
    │     ├ 직접 입력 → textarea("직원들이 자주 묻는 내용을 구체적으로 입력해주세요.")
    │     ├ 파일      → 드래그&드롭 존 + "PDF, DOCX, PPTX, XLSX, MD, TXT · 최대 20 MB" + [파일 선택]
    │     ├ 웹 페이지 → 비활성 스텁("준비 중")
    │     └ 외부 연동 → 비활성 스텁("준비 중")
    │  출처(선택) [예: 사내 공지, 취업규칙 §22]
    │  [취소]   [검토 요청하기 →]
    └  ※ "직접 추가한 내용은 P2 배치 검토로 분류되며…" 안내 박스는 반영하지 않음
```

**제출 활성 조건**: 주제 선택됨 && 제목 비어있지 않음 && 부서 선택됨 && (직접 입력 탭 → 내용 비어있지 않음 / 파일 탭 → 지원 포맷 파일 선택됨).

**파일 포맷 가드**: 표시 텍스트는 6종. DOCX/PPTX/XLSX 선택 시 "추후 지원 예정입니다" 토스트로 클라이언트 차단(서버 415는 백스톱).

---

## 2. 구현 (계층별)

### 2.1 프론트엔드 — 신규 페이지
- **신규** [apps/web/src/components/add/AddPage.tsx] — 위 레이아웃. 재사용:
  - 주제 조회/생성/삭제: `useTopics()`, `useTopicMutations()` ([data/hooks.ts:18,79](../apps/web/src/data/hooks.ts#L79)).
    사이드바의 시스템/사용자 분기·삭제 로직은 `CategoryManagerModal` ([KbPage.tsx:292](../apps/web/src/components/kb/KbPage.tsx#L292)) 패턴 준용.
  - 부서 옵션: `DepartmentSchema.options.filter((d) => d !== '미분류')` (`@wf/shared`, [enums.ts:3](../packages/shared/src/wiki/enums.ts#L3)).
  - 제출(직접 입력): `useIngest()` ([api/hooks.ts:53](../apps/web/src/api/hooks.ts#L53)). 제출(파일): 신규 `useIngestFile()`.
  - 공통 UI(토스트/배지 등): `Primitives` ([components/common/Primitives.tsx]).
  - 성공 시 입력 초기화 + 토스트("검토 요청이 접수되었습니다") + `reviews`/`tree` 무효화. 인메모리 스텁 워커가 인라인 실행되어 즉시 `REVIEW` 진입.
- **신규** [apps/web/src/styles/add.css] — `.add-*` 스코프. `tree/home/kb/doc/review.css`처럼
  [styles/index.css](../apps/web/src/styles/index.css)에 `@import "./add.css";` 추가. 드롭존/진행바는 기존 `.agent-drop`, `.progress-*`, `var(--*)` 토큰 차용.

### 2.2 프론트엔드 — 진입점 연결
- [App.tsx:39](../apps/web/src/App.tsx#L39): `activePage === 'add'` → `<AddPage />` 렌더(스텁 제거).
- [Lnb.tsx:21](../apps/web/src/components/lnb/Lnb.tsx#L21): `nav()`의 토스트 목록에서 `'add'` 제거 → 페이지로 이동.
- [KbPage.tsx:108](../apps/web/src/components/kb/KbPage.tsx#L108): `+ 직접 추가` 버튼 `onClick` → `go('add')`(토스트 제거). `useUiStore`에서 `go` 추가 취득.

### 2.3 프론트엔드 — API 클라이언트/훅
- [api/client.ts](../apps/web/src/api/client.ts):
  - `ingest()`(L91) 인자에 선택적 `topic?`, `department?`, `sourceLabel?` 추가(JSON 본문 포함).
  - **신규** `ingestFile(file, meta)` — `agentPreviewUpload`(L111) 패턴의 **전용 multipart fetch**
    (공유 `request()`는 JSON content-type 강제로 multipart 경계가 깨짐). `POST /api/ingest/file`로
    `file` + `title`/`topic`/`department`/`sourceLabel` 전송.
- [api/hooks.ts](../apps/web/src/api/hooks.ts): `useIngest`가 `reviews`/`tree` 무효화하도록 보강(현재 무효화 없음),
  **신규** `useIngestFile` 추가(동일 무효화).

### 2.4 백엔드 — API / 스토어
- [apps/api/src/server.ts](../apps/api/src/server.ts):
  - 업로드 한도 상향: `PREVIEW_MAX_UPLOAD_BYTES` 12MB → **20MB**(L22; 멀티파트 전역 등록 L40과 공유).
  - `extractPreviewFile`(L71)을 공용 헬퍼로 정리해 재사용(에이전트 미리보기 + 신규 인입). PDF=`unpdf`, md/txt=utf8, 그 외 415.
  - `POST /api/ingest`(L199): 본문 `topic`/`department`/`sourceLabel` 통과 → `store.ingest`.
  - **신규** `POST /api/ingest/file` — `request.isMultipart()` 처리(`readAgentPreviewInput` L78 패턴 준용),
    파일 추출 → `store.ingest({ title, contentMarkdown, topic, department, sourceLabel })`. 추출 공백이면 422, 미지원 포맷 415.
- [apps/api/src/store.ts](../apps/api/src/store.ts): `WekiFlowStore.ingest`(L60) 시그니처에 선택적
  `topic?`/`department?`/`sourceLabel?` 추가. `InMemoryWekiFlowStore.ingest`(L218)는 이를 `sourceRefs[].note`에 기록하고
  기존 `applyStubMainWorker`로 즉시 `REVIEW` 전환(데모/테스트 hermetic 유지).
- [apps/api/src/mongoStore.ts](../apps/api/src/mongoStore.ts): `ingest`(L102)도 동일 시그니처로 mirror
  (`docs.createDraft` 호출에 메타 전달; 깊은 파이프라인 변경 없이 sourceRefs note 수준).

### 2.5 공유 타입 (선택, 안전성)
- `packages/shared`: `IngestRequestSchema`(`title`, `contentMarkdown?`, `topic?`, `department?: DepartmentSchema`, `sourceLabel?`)를
  추가해 server.ts에서 파싱(현재 `request.body as {...}` 느슨). 범위 최소화를 위해 선택 사항.

---

## 3. 재사용 자산 요약
- 주제 CRUD: `useTopics`/`useTopicMutations` + `/api/topics`(이미 system/user·count·삭제 지원).
- 부서 목록: `DepartmentSchema`(신규 데이터 불필요).
- 인입 파이프라인: `useIngest` + `store.ingest`(인라인 스텁 워커 → `REVIEW`).
- 파일 추출: `extractPreviewFile`(unpdf) 헬퍼 재사용.
- 스타일 토큰/드롭존/진행바: `.agent-drop`, `.progress-track`, `var(--*)`.

---

## 4. 확장 지점 (Future)
입력 방식 탭은 **소스 어댑터** 자리만 잡는다. 추후:
- **웹 페이지**: URL 입력 → 서버 크롤/추출 → `contentMarkdown`. `SourceRefSchema.type`에 `'webpage'` 추가 후 동일 인입 경로.
- **외부 연동**: Slack/Notion 등 — 기존 `SourceChannelTypeSchema`(slack/email/notion/…) 자산과 접속.
- **DOCX/PPTX/XLSX**: `extractUploadFile` 헬퍼에 파서(예: `mammoth`) 분기 추가 → 6종 전체 추출.

---

## 5. 검증 (Verification)
- **타입체크**: `pnpm -r build` → `pnpm -r typecheck` (워크스페이스 타입이 dist로 해석되므로 build 선행).
- **단위(hermetic)**: [apps/api/src/server.test.ts](../apps/api/src/server.test.ts) 확장 —
  `POST /api/ingest`(JSON, topic/department 포함) → `{doc,job}`, doc.status `REVIEW`;
  `POST /api/ingest/file`(md/txt 멀티파트) → `REVIEW`; 미지원 포맷 415; 빈 추출 422.
- **수동 E2E**(dev 서버 또는 `run` 스킬):
  1. 로그인 → LNB `직접 추가` → 페이지 렌더(사이드바 시스템/사용자 주제, 부서 드롭다운, 입력 방식 탭).
  2. `+ 새 주제`로 사용자 주제 생성 → 사이드바 "직접 추가한 주제"·주제 배정 칩 즉시 반영, 삭제 동작.
  3. 직접 입력 탭: 주제+제목+부서+내용 → 검토 요청 → LNB `검토` 배지 +1, 트리에 `REVIEW` 문서, 입력 초기화.
  4. 파일 탭: `.md`/`.pdf` 업로드 → 검토 요청 → 동일 확인. `.docx` 선택 시 "추후 지원" 차단 토스트.
  5. KbPage 상단 `+ 직접 추가` → 같은 페이지 이동.

---

## 6. 범위 밖 (Out of Scope)
- 웹 페이지 크롤링 / API / 외부 연동 실제 동작(탭 비활성 스텁만).
- DOCX/PPTX/XLSX 파서 추가.
- "P2 배치 검토" 안내 문구.
- 인입 문서의 실제 카테고리/부서 영속 모델 확장(메타는 sourceRefs note 수준 보존).
