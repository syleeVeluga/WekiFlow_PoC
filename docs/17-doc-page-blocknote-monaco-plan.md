# 단일 문서 화면 BlockNote/Monaco 적용 계획

## 배경

첨부 화면의 단일 문서 페이지는 `apps/web/src/components/doc/DocPage.tsx`에서 별도 구현되어 있다. 현재 `편집` 탭은 마크다운을 일반 본문으로 렌더링한 뒤 `편집하기` 버튼을 눌러 `<textarea>` 편집 모드로 전환한다. `소스`와 `변경 기록` 탭은 문서 메타데이터를 JSON `<pre>`로 보여준다.

기존 Phase 1 구현에는 `BlockNotePane`과 `MonacoDiffPane`가 이미 존재한다. 따라서 새 에디터를 만들지 않고 단일 문서 페이지가 이 컴포넌트를 직접 사용하도록 맞춘다.

## 요구사항 해석

- 화면 내 `편집하기` 버튼은 모두 제거한다.
- 단일 문서 `편집` 탭은 초기 하이브리드 에디터 방향과 맞게 BlockNote 기반으로 렌더링한다.
- `소스` 탭은 JSON 메타데이터가 아니라 현재 문서의 마크다운 원문을 보여준다.
- `변경 기록` 탭은 JSON 출력 대신 Monaco Diff를 사용한다.
- 변경은 단일 문서 화면과 필요한 공용 에디터 props에 한정한다.

## 구현 계획

1. `BlockNotePane`을 단일 문서 편집에서 재사용할 수 있게 `onMarkdownChange` 콜백을 추가한다.
   - verify: BlockNote 내용 변경 시 부모 컴포넌트가 직렬화된 마크다운을 받을 수 있다.
2. `DocPage`의 textarea/`docEditing` 분기를 제거하고, `편집` 탭에 BlockNote를 직접 렌더링한다.
   - verify: `편집하기` 문자열이 `DocPage`에서 사라진다.
3. `소스` 탭은 `contentMarkdown`을 그대로 `<pre><code>`로 렌더링한다.
   - verify: 첨부 화면의 문서 본문 마크다운이 원문 형태로 보인다.
4. `변경 기록` 탭은 lazy 로딩된 `MonacoDiffPane`를 사용한다.
   - verify: Monaco Diff가 마크다운 언어로 표시되고, `draftMarkdown`가 없으면 현재 마크다운을 modified로 사용한다.
5. CSS는 기존 디자인 범위 안에서 BlockNote, source, diff 패널이 단일 문서 카드 안에서 깨지지 않도록 최소 보정한다.
   - verify: 모바일/데스크톱에서 탭과 본문 영역이 겹치지 않는다.

## 검증 기준

- `rg "편집하기" apps/web/src`에서 단일 문서 본문 버튼 문자열이 남지 않는다.
- `corepack pnpm --filter @wf/web typecheck` 통과.
- 가능한 경우 `corepack pnpm --filter @wf/web build` 통과.
- 로컬 개발 서버에서 단일 문서 페이지를 열고 `편집`, `소스`, `변경 기록` 탭을 시각 검증한다.

