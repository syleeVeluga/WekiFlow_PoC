# 23. TODO — 워크스페이스 인가 모델 (Workspace Authorization)

> 외부 인입 API의 미해결 보안 항목을 기록한다.
> *Tracked, intentionally-deferred security gap on the external ingestion API.*

---

## 상태: 미해결 (Open)

발견 시점: 2026-06-01, 외부/멀티파일 인입 기능 리뷰 중.

## 문제 (Problem)

`POST /api/workspaces/:workspaceId/ingestions` 라우트는 `workspaceId` 경로 파라미터를
**존재 여부·소속 여부 검증 없이** 그대로 신뢰한다. 현재 코드베이스에는 워크스페이스
레지스트리나 사용자–워크스페이스 멤버십 개념이 없고, `canEdit`는 **전역 역할**이다.

→ 결과: `canEdit` 권한을 가진 임의의 사용자가 자신이 속하지 않은(또는 존재하지 않는)
임의의 `workspaceId` 문자열로 문서를 생성/태깅할 수 있다. 멀티테넌트 격리가 의도라면
이는 인가 공백이다.

관련 위치: [`apps/api/src/server.ts`](../apps/api/src/server.ts) — `app.post('/api/workspaces/:workspaceId/ingestions', ...)`

## 이미 완화된 부분 (Partially mitigated)

멱등성 스코프를 **소유자 바인딩**(`userId + workspaceId + sourceName + idempotencyKey`)으로
변경해 *교차 사용자 문서 유출* 절반은 막았다 — `buildIngestionIdempotencyScope`
([`packages/shared/src/index.ts`](../packages/shared/src/index.ts)). 즉, 다른 사용자가
같은 키로 재생(replay)해도 남의 문서가 노출되지 않는다. 다만 **임의 워크스페이스 쓰기**
자체는 여전히 가능하다.

## 의도적으로 보류한 이유 (Why deferred)

제대로 된 수정은 단순 패치가 아니라 기능 추가다:
- 사용자–워크스페이스 멤버십(또는 워크스페이스 레지스트리) 도입
- 모든 워크스페이스 스코프 라우트에서 `workspaceId`를 멤버십에 대해 인가
- 시드/마이그레이션 및 프런트 워크스페이스 선택 흐름 반영

PoC 단계에서는 범위 밖으로 두고 알려진 제약으로 추적한다.

## 해야 할 일 (Action items)

- [ ] 워크스페이스 멤버십 모델 설계 (스키마 + 시드)
- [ ] 워크스페이스 스코프 라우트에 `assertWorkspaceMember(user, workspaceId)` 가드 추가
- [ ] 멤버 아님 → 403, 존재하지 않는 워크스페이스 → 404 응답 규약 확정
- [ ] 인가 가드 회귀 테스트 추가
