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
