# Phase 6 - Review

Review is intentionally simple:

- `신규 검토 대상`: unresolved review items.
- `검토`: opens the detail panel.
- `반려`: rejects the item.
- `승인`: approves the item and triggers graph re-indexing.
- `검토 승인 활성화`: settings menu toggle; default off. When off, the review page shows an enablement notice instead of the queue unless older Layer 1 review documents still need resolution.

There are no grouped lanes, ranked badges, batch approval lanes, or ranking tabs.

## Components

```text
apps/web/src/components/review/
  ReviewPage.tsx        // 신규 검토 대상 list
  ReviewDetailPanel.tsx // implemented in ReviewPage.tsx
```

## Data

- `useReviewBoard()` loads unresolved review items.
- `useResolveReview()` handles approve/reject mutations.
- `useSettings()` loads the review approval gate.
- LNB review count uses review items only.

## Definition of Done

- [x] Review page renders only 신규 검토 대상.
- [x] Each item exposes only 검토, 반려, 승인 actions.
- [x] Detail panel shows existing content, suggested content, diff, and source thread.
- [x] Approve/reject goes through the server mutation and invalidates wiki queries.
- [x] Review count decreases after resolved items leave the queue.
- [x] Disabled approval gate shows the settings enablement notice.
- [x] Web typecheck passes.
