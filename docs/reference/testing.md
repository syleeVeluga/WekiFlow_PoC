# Testing Reference

This document is the current testing entrypoint for WekiFlow. Historical testing strategy and early PoC verification notes live in `docs/archive/11-testing-and-verification.md`.

## Current Gates

- `corepack pnpm e2e` runs the browser smoke suite and the core OKF user pipeline.
- `corepack pnpm -r typecheck` checks every workspace package.
- `corepack pnpm test` runs the workspace unit and integration suites.

## Core OKF Pipeline E2E

The primary user-facing pipeline test is `tests/e2e/okf-core-pipeline.spec.ts`.

It starts from an empty knowledge workspace and verifies:

1. Owner login.
2. No published knowledge is visible.
3. Review approval can be enabled.
4. A Markdown file can be uploaded.
5. The uploaded document reaches `REVIEW`.
6. Approval publishes it.
7. The knowledge base shows the published content.
8. The knowledge map includes the document.
9. Ask returns an answer with the uploaded document as a citation.

The Markdown fixture is `tests/fixtures/core-pipeline-policy.md`.

## Manual No-Approval Happy Path

Use this scenario when a developer wants to test the normal route directly without exercising the human approval gate. The expected default is `reviewApprovalEnabled=false`, so an accepted Markdown upload should move through the stub main worker and publish immediately.

### Setup

```powershell
docker compose up -d mongo
corepack pnpm tsx scripts/reset-wiki-state.ts
corepack pnpm --filter @wf/api dev
corepack pnpm --filter @wf/web dev
```

Open the Vite URL, usually `http://127.0.0.1:5173`, and log in with:

- Email: `admin01@veluga.io`
- Password: `admin01@veluga.io`

### Scenario

1. Open `조직 지식`.
2. Confirm the knowledge list is empty after reset.
3. Open the user menu and confirm `검토 승인 활성화` is off. Do not turn it on.
4. Open `직접 추가`.
5. Select a Markdown file. For a deterministic fixture, use `tests/fixtures/core-pipeline-policy.md`.
6. Submit the upload.
7. Return to `조직 지식`.
8. Confirm the uploaded document appears immediately as published knowledge.
9. Open `지식 맵`.
10. Confirm the uploaded document appears as a map node.
11. Open `지식에 질문하기`.
12. Ask: `What does the Remote Access Policy 2026 require for VPN access?`
13. Confirm the answer includes the uploaded document in citations.

### Expected API Checks

The same route can be checked from the browser devtools network tab or with an authenticated request:

- `GET /api/settings` returns `{ "reviewApprovalEnabled": false }`.
- `POST /api/ingest/files` returns an item whose `doc.status` is `PUBLISHED`.
- `GET /api/reviews` returns no review item for the uploaded document.
- `GET /api/tree` includes the uploaded document with `status: "PUBLISHED"`.
- `GET /api/knowledge` includes the uploaded document as a knowledge item.

### Failure Signals

- If `POST /api/ingest/files` returns `REVIEW`, review approval is enabled. Turn it off from the user menu or call `PATCH /api/settings` as an approver with `{ "reviewApprovalEnabled": false }`.
- If the knowledge base remains empty, check the upload response first. A supported `.md` file should be accepted; unsupported formats are intentionally outside this scenario.
- If Ask returns no citation, confirm the uploaded document title or body contains words from the question.

## Empty Test API

Playwright starts a deterministic in-memory API through `tests/e2e/support/empty-api.ts`.

The test API keeps login users but clears documents, published knowledge, review items, candidates, activity, trash, and agent-preview state. This preserves the user login flow while making the knowledge workspace empty for the scenario.

`playwright.config.ts` starts both servers:

- `tests/e2e/support/start-empty-api.mjs`
- `tests/e2e/support/start-web.mjs`

The web server points `VITE_API_URL` at the empty API, so browser tests do not depend on the local MongoDB seed state or live LLM calls.

## Local Data Reset

For the Mongo-backed local app, use:

```powershell
docker compose up -d mongo
corepack pnpm tsx scripts/reset-wiki-state.ts
docker compose stop mongo
```

That reset removes wiki documents and demo review/support data while keeping the system `미분류` topic.
