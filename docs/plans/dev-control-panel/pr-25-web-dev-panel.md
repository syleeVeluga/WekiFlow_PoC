# PR-25 — Web UI: 설정 → 개발자 패널

> 원본 계획 §E. 사용자 대면 마무리. 앞선 모든 PR의 API를 화면으로 노출.
> 상태: 미착수 · 선행: PR-21(게이팅), PR-22(config API), PR-23(프롬프트/인자), PR-24(정책 API) · 후행: 없음 (마지막 PR → 문서 아카이브)

## 목표
슈퍼어드민 전용 개발자 패널을 4개 탭(프롬프트/인자/모델/정책)으로 제공. 각 항목은 "기본 vs 오버라이드"를 명확히 보여주고, 「기본값 복원」으로 오버라이드 제거가 가능하다.

## 범위
- `DevPanel.tsx` 4탭 UI.
- 데이터 훅 4종.
- LNB 톱니 메뉴 「개발자 설정」 + `me.isSuperAdmin` 게이팅.

## 변경 파일
- `apps/web/src/components/admin/DevPanel.tsx`
  - **프롬프트 탭**: 키별 Monaco 에디터(스택에 Monaco 존재) + 「기본값 복원」(오버라이드 제거). placeholder에 빌트인 기본 노출. 6개 키.
  - **인자 탭**: 숫자 폼, 비우면 기본값(placeholder) 사용. zod 범위에 맞춘 입력 검증.
  - **모델 탭**: 텍스트 입력, env 기본값 placeholder. (API 키 입력 없음.)
  - **정책 탭**: `allowed_hosts` 리스트(추가/삭제), `web_max_pages`, `freshness`, `approver_roles`(실제 role 멀티셀렉트).
- `apps/web/src/api/hooks.ts` — `useRuntimeConfig`/`useUpdateRuntimeConfig`/`usePolicy`/`useUpdatePolicy`(기존 `useSettings` 패턴).
- `apps/web/src/components/lnb/Lnb.tsx` — 톱니 메뉴에 「개발자 설정」, `me.isSuperAdmin` 게이팅(에이전트 미리보기 항목과 동형). (인라인 위치: 현재 Lnb.tsx:142-171 메뉴 영역.)

## UX 규약
- 각 필드: 현재 effective 값 + 기본값을 함께 표기(GET /api/admin/config가 둘 다 반환). 오버라이드 중이면 시각 구분.
- 「기본값 복원」 = 해당 키를 null/삭제로 PATCH → 빌트인 사용.
- **반영 시점 명시**: 모델/인자/프롬프트 변경은 "신규 잡부터 적용, 실행 중 잡 불변" 안내 문구 노출(PR-23 로딩 규율).

## 작업 순서
1. 훅 4종(기존 `useSettings`/`useUpdateSettings` 패턴 복제).
2. DevPanel 라우트 + LNB 진입점, `isSuperAdmin` 게이팅.
3. 탭별 폼: 프롬프트(Monaco) → 인자 → 모델 → 정책 순.
4. 기본/오버라이드 표시 + 복원 동작.
5. 비슈퍼어드민 접근 시 메뉴 숨김 + 라우트 가드.

## 검증
- `pnpm -r build` → `pnpm -r typecheck` → `pnpm -r test`.
- 수동 E2E(원본 계획 §검증): 슈퍼어드민 로그인 → 패널 → 프롬프트/인자/모델/정책 각 1건 편집 → 신규 잡(agent-preview 또는 ingest)에서 반영 확인 → 「기본값 복원」 후 빌트인 사용 확인 → 비슈퍼어드민은 메뉴 숨김 + `/api/admin/*` 403.

## 완료 기준
- 슈퍼어드민이 재배포 없이 프롬프트/인자/모델/정책을 런타임 편집·복원 가능.
- 전체 기능 end-to-end 동작.

## 마무리 (원본 §진행·병합 규약)
- 독립 브랜치(`veluga/dev-control-panel`)에서 green CI 후 main 병합.
- 완료 시 `dev-control-panel.md`(및 본 폴더)를 `docs/archive/`로 이동, `docs/plans/README.md` 정리.
- 권한 원칙 1~2줄을 `AGENTS.md` 권한 절에 반영(원본 §유연한 권한 메모).

## 범위 밖
- 프롬프트 버전관리·A/B·감사 히스토리. env API 키 UI 편집(보안상 제외).
