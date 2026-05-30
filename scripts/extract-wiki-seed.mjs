// One-off generator: ports the design mockup's KB_ALL dataset into the typed seed.
// Source : docs/Design Reference/v-wiki.html  (const raw = [...]  +  const AI_TAGS_MAP = {...})
// Output : packages/shared/src/wiki/seedKnowledge.ts  (export const SEED_KNOWLEDGE_ITEMS)
// Re-run : node scripts/extract-wiki-seed.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'docs/Design Reference/v-wiki.html'), 'utf8');

// Slice a balanced literal that starts at `marker` (an opening `[` or `{`) and ends
// at the matching `];`/`};` just before `endMarker`.
function sliceLiteral(startMarker, openChar, endMarker, closeSeq) {
  const s = html.indexOf(startMarker);
  if (s < 0) throw new Error(`marker not found: ${startMarker}`);
  const open = html.indexOf(openChar, s);
  const end = html.indexOf(endMarker, open);
  const close = html.lastIndexOf(closeSeq, end);
  return html.slice(open, close + 1);
}

const raw = new Function(`return ${sliceLiteral('const raw = [', '[', 'return raw.map', '];')}`)();
const aiTags = new Function(`return ${sliceLiteral('const AI_TAGS_MAP = {', '{', 'const CAT_COLORS', '};')}`)();

if (raw.length !== 88) throw new Error(`expected 88 raw items, got ${raw.length}`);

const items = raw.map((it) => {
  const authorName = it.by ?? it.ori?.by ?? '—';
  const item = {
    id: it.id,
    documentId: `doc-${it.id}`,
    title: it.tp,
    summary: it.pv ?? '',
    contentMarkdown: it.full ?? '',
    department: it.dp ?? '미분류',
    category: it.cat ?? '미분류',
    freshness: it.status ?? 'latest',
    usageCount: it.uses ?? 0,
    modCount: it.upd ?? 0,
    sourceLabel: it.src ?? '—',
    authorName,
    updatedAtLabel: it.dt ?? '—',
    aiTags: aiTags[it.id] ?? [],
  };
  if (it.ori) item.origin = { label: '최초 등록', at: it.ori.dt ?? it.dt ?? '', by: it.ori.by ?? authorName, source: it.ori.ct ?? it.src ?? '' };
  if (it.chg) item.lastChange = { label: '편집', at: it.chg.dt ?? '', by: it.chg.by ?? '', source: it.chg.ct ?? '' };
  return item;
});

// Report distribution so it can be eyeballed against the screenshots.
const dist = {};
for (const it of items) dist[it.category] = (dist[it.category] ?? 0) + 1;
console.log('items:', items.length);
console.log('by category:', dist);

const out = `// AUTO-GENERATED from docs/Design Reference/v-wiki.html via scripts/extract-wiki-seed.mjs.
// Do not edit by hand — re-run the script to regenerate.
import type { KnowledgeItem } from './types.js';

export const SEED_KNOWLEDGE_ITEMS: KnowledgeItem[] = ${JSON.stringify(items, null, 2)};
`;

writeFileSync(resolve(root, 'packages/shared/src/wiki/seedKnowledge.ts'), out, 'utf8');
console.log('wrote packages/shared/src/wiki/seedKnowledge.ts');
