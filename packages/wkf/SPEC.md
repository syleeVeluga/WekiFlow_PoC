# WKF v0.1

WKF is WekiFlow's OKF-compatible Markdown knowledge format. A WKF concept document is a Markdown file with YAML frontmatter delimited by `---`, followed by human-readable body sections.

## Core Rules

- `type` is required and must be a non-empty string.
- Consumers must preserve unknown frontmatter keys.
- Missing recommended fields, unknown `type` values, unknown keys, broken links, and absent non-root `index.md` files must not be rejected by permissive consumers.
- `tags` defaults to an empty array when omitted.

## Recommended Frontmatter

```yaml
---
type: REGULATION
title: Annual Leave Policy
description: Leave rules and approval responsibilities.
resource: wekiflow://hr/annual-leave
tags: [hr, leave, policy]
timestamp: 2026-06-19T09:00:00Z
source_tier: official
freshness: 90d
last_verified: 2026-06-19T09:00:00Z
status: PUBLISHED
slug: hr/annual-leave
---
```

## Body Conventions

WKF inherits OKF's readable Markdown body and adds these conventional sections:

- `# Facts`: claims intended for verification.
- `# Schema`: structured fields for datasets or metrics.
- `# Examples`: usage examples or queries.
- `# Relations`: typed graph links serialized as `(Subject) -[Predicate]-> (Object) {strength: 0.9, ref: /path.md}`.
- `# Citations`: numbered or bulleted sources.

## Recommended Types

`REGULATION`, `POLICY`, `PLAYBOOK`, `METRIC`, `ENTITY`, `DATASET`, `PERSON`, and `DEPT` are recommended. The set is intentionally open.
