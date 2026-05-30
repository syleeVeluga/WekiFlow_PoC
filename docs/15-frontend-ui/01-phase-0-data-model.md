# Phase 0 — 데이터 모델 & 타입 (백엔드 기반)

> PRD 🚩 Phase 0: *목업의 풍부한 도메인을 `@wf/shared` 타입 + MongoDB 컬렉션으로 실체화하고 시드로 적재.*
> *Materialize the mockup's rich domain as shared types + Mongo collections + an idempotent seed.*

목표: 5+1 화면이 소비할 **데이터 계약**을 먼저 못 박는다. 모든 화면 작업(Phase 3~6)과 API(Phase 1)는 이 타입에 의존한다. 기존 `DocumentDTO`/`TreeNode`는 건드리지 않고 **추가만** 한다.

---

## 1. `packages/shared/src/wiki/` 신설

기존 `packages/shared/src/index.ts`의 Zod 패턴(`z.enum` + `z.infer`)을 그대로 따른다. `index.ts` 말미에 `export * from './wiki/index.js';`를 추가한다.

```
packages/shared/src/wiki/
  enums.ts     // 스칼라 enum + Zod
  types.ts     // 객체 스키마 + Zod + z.infer
  index.ts     // re-export
```

> ⚠️ ESM + `NodeNext`: 상대 import는 **`.js` 접미사 필수**(`./enums.js`). `exactOptionalPropertyTypes`가 켜져 있으므로 `null` 가능 필드는 `| null`을 명시(예: `existing?: ReviewExisting | null`).

### 🛠️ 0.1 enums (`wiki/enums.ts`)

```ts
import { z } from 'zod';

export const ReviewPrioritySchema = z.enum(['p0', 'p1', 'p2']);
export const ChangeTypeSchema = z.enum(['conflict', 'update', 'new']);     // 목업 cf|upd|new 정규화
export const CertaintySchema = z.number().int().min(1).max(5);             // 목업 ct (●○ dots)
export const SourceAuthoritySchema = z.enum(['L1', 'L2', 'L3', 'L4']);
export const SourceChannelTypeSchema = z.enum(['slack', 'email', 'notion', 'manual', 'datasource']);
export const MultiSourceTypeSchema = z.enum(['A', 'B', 'C', 'D']);         // 동일|유사|상충|선택적
export const KnowledgeFreshnessSchema = z.enum(['latest', 'needs_update', 'conflict']);
export const TopicSourceSchema = z.enum(['system', 'user']);
export const ActivityActorSchema = z.enum(['user', 'ai', 'conflict']);
export const ActivityKindSchema = z.enum(['create', 'edit', 'detect']);

export type ReviewPriority = z.infer<typeof ReviewPrioritySchema>;
export type ChangeType = z.infer<typeof ChangeTypeSchema>;
export type Certainty = z.infer<typeof CertaintySchema>;
export type SourceAuthority = z.infer<typeof SourceAuthoritySchema>;
export type MultiSourceType = z.infer<typeof MultiSourceTypeSchema>;
export type KnowledgeFreshness = z.infer<typeof KnowledgeFreshnessSchema>;
// …(나머지 동일 패턴)
```

> ⚠️ **`KnowledgeFreshness`는 `DocumentStatus`(`DRAFT|…|FAILED`)와 절대 통합 금지.** 신선도(콘텐츠 최신성) vs 라이프사이클(문서 상태)은 직교 축이다. `KnowledgeItem.documentId`로 두 모델을 join한다.

### 🛠️ 0.2 객체 타입 (`wiki/types.ts`)

목업 필드 → 타입 매핑(핵심). 색상/아이콘 맵(`CAT_COLORS`, `AVATAR_COLORS`)은 표현 관심사이므로 **shared가 아닌 `apps/web`** 에 둔다.

| 타입 | 목업 출처 | 필드 매핑(발췌) |
| :--- | :--- | :--- |
| `Topic` | `TOPICS[]` | `id`, `name`, `source(system\|user)`, `isUnclassified?` |
| `KnowledgeItem` | `KB_ALL[]` | `tp→title`, `pv→summary`, `full→contentMarkdown`, `dp→department`, `cat→category`, `status→freshness`, `uses→usageCount`, `upd→modCount`, `src→sourceLabel`, `by→authorName`, `dt→updatedAtLabel`, `aiTags`, `ori→origin`, `chg→lastChange`, `documentId?`(seam) |
| `AiTagSuggestion` | `AI_TAG_SUGGEST[]` | `id`, `itemId`, `itemTitle`, `tag`, `reason` |
| `ReviewItem` | `RV_ALL[]` | `t→changeType`(cf→conflict), `pri→priority`, `ct→certainty`, `dp→department`, `tp→topicTitle`, `srcType/srcCh/srcTime/srcAuthor→source{…}`, `ex→existing`, `nw→newValue`, `ct_text→newContent`, `dl→diff`, `thread`, `reason`, `priReason→priorityReason`, `documentId?` |
| `ReviewExisting` | `ex{content,est,by,src}` | `content`, `establishedAt`, `by`, `source` |
| `DiffLine` | `dl[]{t,c}` | `kind(add\|del)`, `content` |
| `ConflictThread` | `thread` | `type(slack\|email)`, `channel?`, `from?`, `to?`, `subj?`, `date`, `messages:SourceMessage[]`, `body?` |
| `SourceMessage` | `thread.msgs[]` / `sources[]` | `channel`, `channelType`, `icon?`, `author`, `time`, `content`, `isBaseline?`, `authorityLevel?`, `highlight?(hl)` |
| `MultiSourceGroup` | `MS_GROUPS[]` | `msType→multiSourceType`, `pri→priority`, `ct→certainty`, `dp→department`, `tp→topicTitle`, `desc→description`, `sources[]`, `resolvedContent\|null`, `targets[]`, `reason`, `priReason→priorityReason` |
| `MultiSourceTarget` | `targets[]` | `id`, `title`, `current`, `category`, `selected?`(UI) |
| `ActivityEntry` | `HIST_ALL[]` | `who→actor`, `wl→actorLabel`, `dp→department`, `k→kind`, `tg→targetTitle`, `time`, `dateLabel?` |
| `CoverageStat` | 홈 `people[]`/`mat[]`/`KB_PEOPLE` | `key`, `label`, `count`, `role?`, `tone?(ok\|warn\|error)`, `flag?` |
| `DigestSection` / `DailyDigest` | `renderHome` 다이제스트 | `DailyDigest{dateLabel, leadCounts{detected,conflicts,toApply}, topSearch?, sections:DigestSection[]}`; `DigestSection{title, pill?, tone, entities:DigestEntityRef[]}`; `DigestEntityRef{kind, itemId, title, quote?}` |

```ts
// 발췌 — KnowledgeItem
export const KnowledgeItemSchema = z.object({
  id: z.string(),                        // 'k01'
  title: z.string(),                     // tp
  summary: z.string(),                   // pv
  contentMarkdown: z.string(),           // full
  department: DepartmentSchema,          // dp
  category: z.string(),                  // cat (Topic.name 매칭)
  freshness: KnowledgeFreshnessSchema,   // status
  usageCount: z.number().int(),          // uses
  modCount: z.number().int(),            // upd
  sourceLabel: z.string(),               // src
  authorName: z.string(),                // by
  updatedAtLabel: z.string(),            // dt
  aiTags: z.array(z.string()).default([]),
  origin: KnowledgeProvenanceSchema.optional(),    // ori
  lastChange: KnowledgeProvenanceSchema.optional(),// chg
  documentId: z.string().optional(),     // ← seam: 실 DocumentDTO 연결
});
export type KnowledgeItem = z.infer<typeof KnowledgeItemSchema>;
```

> ⚠️ UI 전용 런타임 상태(`open`, `selectedVer`, `targets[].selected`, `rvDone`)는 shared 타입에서 **optional** 로 두고, 실제 토글 상태는 프론트 스토어가 보유한다(Phase 2).

---

## 2. MongoDB 컬렉션 확장 (`docs/03-data-model.md` 형식)

기존 `documents`/`chunks`/`kg_*`/`jobs`/`users`/`sandbox_runs`는 유지. 아래를 추가한다.

### 🛠️ 0.3 `documents` 필드 추가 (additive)

```jsonc
{
  // …기존 필드…
  "topicId": "ObjectId(topics)|null",   // 카테고리(주제) 분류
  "department": "총무팀|인사팀|IT팀|…",  // 담당 조직
  "freshness": "latest|needs_update|conflict"  // 신선도 (status 라이프사이클과 별개)
}
```

### 🛠️ 0.4 신규 컬렉션

```jsonc
// topics — 주제 분류(시스템 기본 + 사용자 추가)
{ "_id":"ObjectId", "name":"법인카드", "source":"system|user",
  "isUnclassified":false, "createdAt":"ISODate", "updatedAt":"ISODate" }

// review_items — 검토 큐 항목(파이프라인이 감지한 변화)
{ "_id":"ObjectId", "changeType":"conflict|update|new", "priority":"p0|p1|p2",
  "certainty":2, "department":"인사팀", "topicTitle":"건강검진 대상 기준",
  "source":{ "type":"slack|email", "channel":"#HR공지", "time":"오전 10:14", "author":"박민지" },
  "existing":{ "content":"…","establishedAt":"…","by":"…","source":"…" },
  "newValue":"…", "newContent":"…", "diff":[{ "kind":"del","content":"…" }],
  "thread":{ "type":"slack","channel":"#HR공지","date":"…","messages":[…] },
  "reason":"…", "priorityReason":"…",
  "documentId":"ObjectId|null", "resolved":false,
  "createdAt":"ISODate" }

// multi_source_groups — 멀티소스 통합 검토
{ "_id":"ObjectId", "multiSourceType":"A|B|C|D", "priority":"p2", "certainty":4,
  "department":"인사팀", "topicTitle":"경조사 지원금 — 본인 결혼", "description":"…",
  "sources":[{ "channel":"#복리후생","authorityLevel":"L1","author":"박민지",
               "time":"오전 09:05","content":"…","isBaseline":true }],
  "resolvedContent":"…|null",
  "targets":[{ "documentId":"ObjectId","title":"…","current":"…","category":"복리후생" }],
  "reason":"…", "priorityReason":"…", "resolved":false, "createdAt":"ISODate" }

// ai_tag_suggestions — AI 자동 분류 태그 제안(검토 대기)
{ "_id":"ObjectId", "itemId":"ObjectId(documents)", "itemTitle":"택배 수령 절차",
  "tag":"사무환경", "reason":"…", "status":"pending|approved|rejected", "createdAt":"ISODate" }

// activity_log — 최근 활동 / 변경 이력 피드
{ "_id":"ObjectId", "actor":"ai|user|conflict", "actorLabel":"LORE",
  "kind":"create|edit|detect", "department":"총무팀", "targetTitle":"전기차 충전소 이용",
  "time":"방금 전", "createdAt":"ISODate" }
```

### 🛠️ 0.5 인덱스 (`packages/db/src/ensureIndexes.ts`에 멱등 추가)

```js
db.topics.createIndex({ name: 1 }, { unique: true });
db.review_items.createIndex({ priority: 1, resolved: 1 });
db.review_items.createIndex({ resolved: 1, createdAt: -1 });
db.multi_source_groups.createIndex({ resolved: 1 });
db.ai_tag_suggestions.createIndex({ status: 1 });
db.activity_log.createIndex({ createdAt: -1 });
db.documents.createIndex({ topicId: 1 });
db.documents.createIndex({ department: 1 });
```

> ⚠️ `home` 다이제스트 지표는 **집계 결과**이므로 별도 컬렉션을 두지 않고 Phase 1의 `/api/home/digest`에서 `review_items`/`documents`/`activity_log`를 roll-up 한다(일부 정적 지표는 시드 상수).

---

## 3. 시드 전략 (목업 → DB)

목업 데이터를 타입드 시드로 이식한다. `scripts/seed-wiki.ts`(tsx 실행) 또는 `packages/db`의 시드 모듈로 작성하고 **멱등**(upsert)으로 만든다.

### 🛠️ 0.6 이식 매핑 & 정규화

- `KB_ALL`(k01..k88) → `documents`(+`contentMarkdown=full`, `department=dp`, `freshness=status`, `topicId`=`cat`로 매칭) + `topics`(시스템 기본 + 사용자 추가). `enrichKB` 로직(=`AI_TAGS_MAP` 병합, `by` 폴백, `cat` 기본 '미분류')을 이식해 적재 전 보강.
- `RV_ALL` → `review_items` (`t:cf→conflict` 등 정규화, `ct→certainty`).
- `MS_GROUPS` → `multi_source_groups` (`targets`의 카테고리/현재값 보존, `documentId`는 제목 매칭으로 연결).
- `AI_TAG_SUGGEST` → `ai_tag_suggestions` (`status:'pending'`).
- `HIST_ALL` → `activity_log`.
- `SRC_AUTH`/`srcLevel()`(채널→L1..L4) → 시드 상수 또는 채널 설정(현재는 `apps/web` 상수로도 충분, Phase 1에서 응답에 권위 등급 부여).

```ts
// scripts/seed-wiki.ts (개요)
import { normalizeEntityName } from '@wf/shared';        // 재사용: 카테고리/엔티티 매칭 키
// 1) topics upsert (system + user)
// 2) documents upsert (KB_ALL → KnowledgeItem 매핑, topicId 연결, enrichKB 보강)
// 3) review_items / multi_source_groups / ai_tag_suggestions / activity_log upsert
// 모두 unique 키(예: 제목+부서, 또는 목업 id를 slug로) 기준 upsert → 재실행 안전
```

> ⚠️ 시드는 `documents.slug`를 목업 `id`(k01…)나 제목 기반으로 안정 생성해 재실행 시 중복 적재 방지. `normalizeEntityName`을 매칭 키로 재사용한다.

---

## 4. ✅ 완료 기준 (Definition of Done)

- [x] `packages/shared/src/wiki/{enums,types,index}.ts` 작성 + `index.ts` 재export. `pnpm -r build` 후 `@wf/shared`에서 `KnowledgeItem`/`ReviewItem`/`MultiSourceGroup`/`Topic`/`AiTagSuggestion` 등 신규 타입 import 가능.
- [x] 기존 `DocumentDTO`/`TreeNode`/`canApprove`/`normalizeEntityName`/`chunkMarkdown` **무변경**(additive only) 확인.
- [x] `KnowledgeFreshness`와 `DocumentStatus`가 별개 enum으로 공존.
- [x] `ensureIndexes.ts`에 신규 컬렉션 인덱스 멱등 추가.
- [x] `scripts/seed-wiki.ts` 실행 시 `documents` ≥ 88건 + `topics` + `review_items` + `multi_source_groups` + `ai_tag_suggestions` + `activity_log` 적재. **재실행해도 개수 불변(멱등)**.
- [x] `pnpm -r build && pnpm -r typecheck` 통과 (build 선행 — 워크스페이스 타입 stale dist 이슈).

> ✅ 게이트 통과 시 **Phase 1**(API 엔드포인트)로 진행. 신규 타입은 서버·워커·프론트가 공유하는 단일 계약이 된다.
> ⚠️ `home` 집계 지표는 컬렉션이 아니라 Phase 1 엔드포인트에서 계산 — 이 단계에서는 원천 데이터(`review_items`/`activity_log`)만 적재한다.
