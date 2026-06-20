# 개발자/슈퍼어드민 제어판 — PR 단위 실행 계획

원본 단일 계획([../dev-control-panel.md](../dev-control-panel.md))을 의존성 순서대로 **5개 PR**로 분해한 것. 각 PR은 독립 브랜치에서 green CI 후 병합 가능한 단위다.

> 배경: PR-19(외부 enrichment)·PR-20(WKF MCP·커넥터)은 이미 구현 완료. 본 계획은 그 위에 올라가는 잔여 작업으로, PR 번호를 PR-21~25로 이어 매긴다.

## PR 목록

| PR | 제목 | 원본 §| 핵심 산출물 |
|----|------|------|-------------|
| [PR-21](./pr-21-superadmin-flag.md) | 직교 슈퍼어드민 플래그 | A | 완료 — `isSuperAdmin` + `canAccessDevPanel`, `/api/admin/*` 게이트 |
| [PR-22](./pr-22-runtime-config-store.md) | 런타임 config 저장소 | B | 완료 — `RuntimeConfigSchema`, repo, `loadRuntimeConfig` 머지, config API |
| [PR-23](./pr-23-prompt-injection-seam.md) | 프롬프트 주입 seam + 인자 배선 | C(+B) | 완료 — 프롬프트 6키 seam, 워커 prompts·agentParams 주입 |
| [PR-24](./pr-24-policy-runtime-override.md) | 정책 런타임 오버라이드 + role 정합 | D | `loadEffectivePolicy`, role 검증, policy API (PR-19 직결) |
| [PR-25](./pr-25-web-dev-panel.md) | Web UI 개발자 패널 | E | DevPanel 4탭, 훅, LNB 진입점 |

## 의존성 그래프

```
PR-21 (게이트) ──┬─→ PR-22 (config 저장소) ──┬─→ PR-23 (프롬프트/인자) ──┐
                 │                            └─→ PR-24 (정책)          ├─→ PR-25 (UI)
                 └────────────────────────────────────────────────────┘
```

- **PR-21**: 완료(PR #31).
- **PR-22**: 완료(PR #33).
- **PR-23**: 완료(PR #35).
- **PR-24**: PR-22 필요.
- **PR-25**: PR-21·22·23·24 전부 필요. 마지막.

## 권장 순서
PR-21 → PR-22 → (PR-23 ∥ PR-24) → PR-25.

## 공통 검증 게이트 (모든 PR)
`pnpm -r build` → `pnpm -r typecheck` → `pnpm -r test`
(타입은 빌드 dist로 해소되므로 typecheck 전 build 필수.)

## 횡단 원칙
- `isSuperAdmin`는 role 랭크와 **직교** — 향후 WKF 권한 재설계와 충돌 없음.
- policy role 값을 live enum과 대조 검증 — 조용한 drift 방지.
- 이 원칙을 `AGENTS.md` 권한 절에 1~2줄 반영(PR-25 마무리).

## 완료 후
모든 PR 병합 시 원본 `dev-control-panel.md`와 본 폴더를 `docs/archive/`로 이동하고 [../README.md](../README.md) 정리.

## 범위 밖 (전체)
워크스페이스 멤버십 구현 · 프롬프트 버전관리/A·B/감사 히스토리 · 정책 hot-reload · env API 키 UI 편집.
