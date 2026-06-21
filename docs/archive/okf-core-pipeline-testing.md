# OKF Core Pipeline Testing Plan

## Scope

Validate the smallest user-visible OKF loop from an empty workspace:

1. Log in as an owner.
2. Confirm no published knowledge is visible.
3. Enable review approval.
4. Upload one Markdown file.
5. Confirm the AI-organized draft reaches review.
6. Approve the draft.
7. Confirm the published knowledge appears in the knowledge base.
8. Confirm the knowledge map includes the published document.
9. Ask a question and confirm the answer includes the uploaded document as a citation.

## Explicit Assumptions

- "Empty" means user accounts remain available for login, but documents, published knowledge, review items, candidates, activity, and other demo content are cleared.
- The test uses Markdown only. PDF, DOCX, PPTX, XLSX, and TXT are outside this core scenario.
- The e2e API uses the in-memory store and deterministic discovery response so the test validates product wiring without depending on live LLM calls.
- Review approval is enabled during the scenario to exercise the human gate.

## Playwright Coverage

- `tests/e2e/okf-core-pipeline.spec.ts` drives the UI through upload, review, publish, map, and ask.
- `tests/e2e/support/empty-api.ts` starts an empty in-memory API server for this test surface.
- `tests/fixtures/core-pipeline-policy.md` is the Markdown upload fixture.

## Success Criteria

- The uploaded document is returned from `/api/ingest/files` in `REVIEW`.
- The review page shows the uploaded document and approval succeeds.
- The knowledge base shows exactly the newly published document content relevant to the fixture.
- The knowledge map contains the uploaded document node.
- The ask page returns an answer and citation for the uploaded document.
