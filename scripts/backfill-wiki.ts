// One-shot backfill: materialize a wiki KnowledgeItem for already-approved documents that were
// approved before publish() started writing `wiki`. Without this they stay orphaned — invisible in
// the KB and Document Tree. Approved docs sit at PUBLISHED or (after the graph worker runs)
// GRAPH_INDEXED. Recovers the assigned topic/workspace from the document fields, falling back to
// parsing the `sourceRefs[].note` (e.g. "topic=계획; workspace=총무팀; source=PLAN.md"; older notes
// used "department=" instead of "workspace=").
import { closeMongoClient, getDb } from '@wf/db';
import { buildIngestedKnowledgeItem } from '@wf/shared';

/** Pull "topic=…; workspace=…|department=…; source=…" values out of an ingest sourceRefs note. */
function parseNote(note: unknown): { topic?: string; workspace?: string; sourceLabel?: string } {
  if (typeof note !== 'string') return {};
  const out: { topic?: string; workspace?: string; sourceLabel?: string } = {};
  for (const part of note.split(';')) {
    const [key, ...rest] = part.split('=');
    const value = rest.join('=').trim();
    if (!value) continue;
    const name = key.trim();
    if (name === 'topic') out.topic = value;
    else if (name === 'workspace' || name === 'department') out.workspace = value;
    else if (name === 'source') out.sourceLabel = value;
  }
  return out;
}

const db = await getDb();
const orphans = await db
  .collection('documents')
  .find({ status: { $in: ['PUBLISHED', 'GRAPH_INDEXED'] }, 'wiki.id': { $exists: false }, preview: { $ne: true } })
  .toArray();

let updated = 0;
for (const doc of orphans) {
  const note = Array.isArray(doc.sourceRefs) && doc.sourceRefs[0] ? doc.sourceRefs[0].note : undefined;
  const fromNote = parseNote(note);
  const topic = (typeof doc.topic === 'string' ? doc.topic : undefined) ?? fromNote.topic;
  const workspace = (typeof doc.workspace === 'string' ? doc.workspace : undefined) ?? fromNote.workspace;
  const sourceLabel = (typeof doc.sourceLabel === 'string' ? doc.sourceLabel : undefined) ?? fromNote.sourceLabel;
  const wiki = buildIngestedKnowledgeItem({
    id: doc._id.toString(),
    title: String(doc.title ?? 'Untitled'),
    contentMarkdown: String(doc.contentMarkdown ?? ''),
    ...(topic ? { category: topic } : {}),
    ...(workspace ? { workspace } : {}),
    ...(sourceLabel ? { sourceLabel } : {}),
  });
  await db.collection('documents').updateOne({ _id: doc._id }, { $set: { wiki } });
  updated += 1;
}

await closeMongoClient();
console.log(JSON.stringify({ scanned: orphans.length, backfilled: updated }, null, 2));
