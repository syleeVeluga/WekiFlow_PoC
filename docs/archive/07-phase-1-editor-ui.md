# Phase 1 — 투트랙 에디터 UI & 기본 인프라 뼈대

> PRD 🚩 Phase 1: *Vite React (BlockNote ↔ Monaco 하이브리드 토글) + Node.js 백엔드 + BullMQ 메인 큐.*
> *Two-track editor UI + backend skeleton + main queue.*

목표: 사용자가 문서를 **BlockNote로 열람/편집**하고, **Monaco Diff로 검토**하며, "직접 추가/데이터소스"로 **메인 큐에 잡을 인입**할 수 있는 동작하는 골격.

---

## 1. 프론트엔드 (`apps/web`)

### 🛠️ 1.1 스캐폴딩

```bash
pnpm create vite@latest web -- --template react-ts
# 이후 React 19로 업그레이드
pnpm --filter web add react@^19 react-dom@^19
pnpm --filter web add @blocknote/core@^0.50 @blocknote/react@^0.50 @blocknote/mantine@^0.50
pnpm --filter web add @monaco-editor/react@^4.7 monaco-editor
pnpm --filter web add @tanstack/react-query@^5 zustand@^5
```

> ⚠️ Monaco는 Vite에서 워커 설정 필요. `@monaco-editor/react`의 `loader`로 CDN 로딩하거나 `vite-plugin-monaco-editor`를 사용. React 19 호환 이슈 시 `@monaco-editor/react@next`(4.7-rc) 확인.

### 🛠️ 1.2 하이브리드 토글 컴포넌트 (핵심)

```tsx
// apps/web/src/components/HybridEditor.tsx
type ViewMode = 'read' | 'review';   // BlockNote(열람/편집) ↔ Monaco Diff(정밀 검토)

function HybridEditor({ doc }: { doc: DocumentDTO }) {
  const [mode, setMode] = useState<ViewMode>('read');
  return (
    <>
      <Toolbar mode={mode} onToggle={setMode} status={doc.status} />
      {mode === 'read'
        ? <BlockNoteView markdown={doc.contentMarkdown} editable={doc.status !== 'PUBLISHED'} />
        : <Suspense fallback={<Spinner/>}>
            <MonacoDiffLazy
              original={doc.contentMarkdown}     // 승인된 본문
              modified={doc.draftMarkdown}       // 파이프라인 A 병합 초안
              language="markdown"
            />
          </Suspense>}
    </>
  );
}
```

**설계 규칙(02 문서 재확인):**
- 두 에디터 **동시 마운트 금지** — 조건부 렌더링.
- Monaco는 **lazy import**(`React.lazy`)로 초기 번들 경량화.
- BlockNote ↔ 마크다운 직렬화: `editor.blocksToMarkdownLossy()` / `tryParseMarkdownToBlocks()`.

### 🛠️ 1.3 화면 (PRD §4 UI/UX 매핑)

| 메뉴 | 화면 | 컴포넌트 |
| :--- | :--- | :--- |
| 📁 문서 트리 | 좌측 무한 뎁스 트리(인접 리스트 → 트리 변환) | `DocumentTree` |
| 🔴 검토 (n) | 검토 대기 목록 → 진입 시 Monaco Diff | `ReviewQueue`, `HybridEditor(review)` |
| 🔷 조직 지식 (n) | 배포 문서 → BlockNote 렌더 | `KnowledgeBase`, `HybridEditor(read)` |
| 🔗 데이터 소스 / ✏️ 직접 추가 | 인입 폼 → Main Queue 트리거 | `IngestForm` |

### 🛠️ 1.4 서버 상태 & 실시간

- `@tanstack/react-query`로 문서/검토목록 페칭.
- 에이전트 진행 상황은 **SSE**(`EventSource`)로 구독해 진행률·도구호출 로그 표시.

---

## 2. 백엔드 API (`apps/api` — Fastify)

### 🛠️ 2.1 스캐폴딩

```bash
pnpm --filter api add fastify @fastify/cors @fastify/sse-v2 zod
pnpm --filter api add bullmq ioredis mongodb
```

> 프레임워크 선택 근거(`02-tech-stack.md`): 단일 서비스 API + 스키마 검증 + 좋은 성능 → **Fastify**. (대규모 엔터프라이즈 모듈화가 필요해지면 NestJS 재검토.)

### 🛠️ 2.2 라우트 명세 (REST)

| Method | Path | 설명 |
| :--- | :--- | :--- |
| `GET` | `/api/tree` | 문서 트리(인접 리스트) 반환 |
| `GET` | `/api/documents/:id` | 문서 단건(content+draft) |
| `POST` | `/api/documents` | 폴더/문서 생성 |
| `POST` | `/api/ingest` | 정보 인입 → `documents`(DRAFT) 생성 + **Main Queue enqueue** |
| `GET` | `/api/reviews` | status=REVIEW 목록 |
| `POST` | `/api/documents/:id/approve` | ✅승인: status=PUBLISHED + **Graph Queue enqueue** |
| `POST` | `/api/documents/:id/reject` | 반려 |
| `GET` | `/api/jobs/:id/stream` | **SSE**: 잡 진행 상황 스트림 |

- 모든 입력은 zod 스키마로 검증(Fastify type provider).
- `approve`는 RBAC: `ADMIN`/`REVIEWER`만(03 문서).

### 🛠️ 2.3 큐 연동 (producer)

```ts
// POST /api/ingest
const doc = await documentsRepo.createDraft({ title, parentId, sourceRefs });
await mainQueue.add('INGEST', { documentId: doc._id.toString() }, {
  attempts: 3, backoff: { type: 'exponential', delay: 2000 },
});
```

`approve`:
```ts
await documentsRepo.publish(id, userId);          // status=PUBLISHED
await graphQueue.add('EXTRACT_TRIPLETS', { documentId: id });
```

### 🛠️ 2.4 워커 스텁

이 단계의 Main Worker는 **에이전트 없이 더미 병합**(`draftMarkdown = contentMarkdown + "\n\n[merged]"`)으로 큐→상태전이→SSE 흐름만 검증. 실제 에이전트는 Phase 2에서 주입.

---

## 3. 엔드투엔드 흐름 검증 (E2E Smoke)

```
✏️ 직접 추가(폼 제출)
  → POST /api/ingest → documents(DRAFT) + Main Queue
  → (스텁) Main Worker → draftMarkdown 생성 → status=REVIEW
  → 🔴 검토 목록에 노출 → 진입 → Monaco Diff(original vs modified)
  → ✅승인 → status=PUBLISHED → Graph Queue enqueue(소비자는 Phase 3에서)
  → 🔷 조직 지식 목록에 노출 → BlockNote 렌더
```

---

## 4. ✅ 완료 기준 (Definition of Done) — ✅ 완료 (2026-05-30)

- [x] BlockNote 열람/편집 ↔ Monaco Diff 토글이 한 문서에서 매끄럽게 전환. (`HybridEditor.tsx` 조건부 렌더링)
- [x] Monaco Diff가 `contentMarkdown`(original) vs `draftMarkdown`(modified)을 좌우 비교 표시. (`MonacoDiffPane.tsx`)
- [x] 문서 트리(무한 뎁스)가 인접 리스트에서 렌더. (`buildTree.ts` + `DocumentTree.tsx`)
- [x] `/api/ingest` → Main Queue → (스텁)워커 → REVIEW 전이가 동작. (`server.test.ts`에서 `IngestStatus=REVIEW`)
- [x] SSE로 잡 진행 상황이 프론트에 실시간 표시. (`/api/jobs/:id/stream` ↔ `useJobStream` EventSource → `IngestForm` 진행바)
- [x] `approve` 시 Graph Queue에 잡이 적재됨. (`GraphJobType=EXTRACT_TRIPLETS` 확인)
- [x] RBAC: 비권한 사용자의 승인 차단. (`DeniedStatus=403`)

> ✅ 게이트 통과 — 검증 증거는 [`14-goal-completion-audit.md`](./14-goal-completion-audit.md) 3차 점검 표 참조. **Phase 2**(샌드박스 + 실제 에이전트)가 다음 단계.
> ⚠️ 단, 브라우저 시각 검증은 런타임 이슈로 미수행 — Vite production build·dev 서버 HTTP 200·API HTTP smoke로 대체 검증.
