import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import type { KnowledgeItem, KnowledgeMap, KnowledgeMapEdge, KnowledgeMapNode } from '@wf/shared';
import { extractHeadings, parseRelations } from './sections.js';
import { parse } from './parse.js';

const RESERVED_MARKDOWN = new Set(['index.md', 'log.md']);
const MARKDOWN_LINK = /!?\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

interface SourceDoc {
  id: string;
  title: string;
  path: string;
  type: string;
  tags: string[];
  markdown: string;
}

function normalizePath(path: string): string {
  return path.split(sep).join('/');
}

function stripMarkdownExtension(path: string): string {
  return path.replace(/\.md$/i, '').replace(/\/index$/i, '');
}

function normalizeEntity(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

async function listMarkdownFiles(bundlePath: string, dir = bundlePath): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === '.wkf' || entry.name === '.ref' || entry.name === 'references') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listMarkdownFiles(bundlePath, path)));
    if (entry.isFile() && entry.name.endsWith('.md') && !RESERVED_MARKDOWN.has(entry.name)) files.push(path);
  }
  return files.sort((a, b) => normalizePath(relative(bundlePath, a)).localeCompare(normalizePath(relative(bundlePath, b))));
}

function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:|tel:|#)/i.test(href);
}

function resolveHref(sourcePath: string, href: string): string {
  const [withoutHash] = href.split('#');
  if (!withoutHash) return '';
  if (withoutHash.startsWith('/')) return stripMarkdownExtension(withoutHash.replace(/^\/+/, ''));
  return stripMarkdownExtension(normalizePath(join(dirname(sourcePath), withoutHash)));
}

function nodeFromDoc(doc: SourceDoc): KnowledgeMapNode {
  return {
    id: doc.id,
    title: doc.title,
    path: doc.path,
    type: doc.type,
    tags: doc.tags,
    headingCount: extractHeadings(doc.markdown).length,
    linkCount: 0,
    backlinkCount: 0,
  };
}

function addEdge(edges: KnowledgeMapEdge[], edge: KnowledgeMapEdge): void {
  if (!edges.some((existing) => existing.id === edge.id)) edges.push(edge);
}

export function buildLinkGraph(docs: SourceDoc[], options: { includeTypedRelations?: boolean } = {}): KnowledgeMap {
  const nodes = docs.map(nodeFromDoc);
  const byPath = new Map(docs.map((doc) => [stripMarkdownExtension(doc.path), doc]));
  const bySlug = new Map(docs.map((doc) => [doc.id, doc]));
  const byTitle = new Map(docs.map((doc) => [normalizeEntity(doc.title), doc]));
  const edges: KnowledgeMapEdge[] = [];
  const unresolvedLinks: KnowledgeMap['unresolvedLinks'] = [];

  for (const doc of docs) {
    for (const match of doc.markdown.matchAll(MARKDOWN_LINK)) {
      if (match[0].startsWith('!')) continue;
      const label = match[1]!.trim();
      const href = match[2]!.trim();
      if (isExternalHref(href)) continue;
      const targetPath = resolveHref(doc.path, href);
      const target = byPath.get(targetPath) ?? bySlug.get(targetPath) ?? byTitle.get(normalizeEntity(label));
      if (!target) {
        unresolvedLinks.push({ source: doc.id, target: href, label });
        continue;
      }
      addEdge(edges, {
        id: `link:${doc.id}:${target.id}:${label}`,
        source: doc.id,
        target: target.id,
        label,
        kind: 'markdown_link',
      });
    }

    for (const tag of doc.tags) {
      const tagId = `tag:${normalizeEntity(tag)}`;
      if (!nodes.some((node) => node.id === tagId)) {
        nodes.push({ id: tagId, title: `#${tag}`, path: `tag://${tag}`, type: 'TAG', tags: [], headingCount: 0, linkCount: 0, backlinkCount: 0 });
      }
      addEdge(edges, {
        id: `tag:${doc.id}:${tagId}`,
        source: doc.id,
        target: tagId,
        label: tag,
        kind: 'tag',
      });
    }

    if (options.includeTypedRelations) {
      for (const relation of parseRelations(doc.markdown)) {
        const target = byTitle.get(normalizeEntity(relation.object)) ?? bySlug.get(relation.object);
        if (!target) continue;
        addEdge(edges, {
          id: `typed:${doc.id}:${target.id}:${relation.predicate}`,
          source: doc.id,
          target: target.id,
          label: relation.predicate,
          kind: 'typed_relation',
        });
      }
    }
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (source) source.linkCount += 1;
    if (target) target.backlinkCount += 1;
  }

  return {
    nodes,
    edges,
    unresolvedLinks,
    generatedAt: new Date().toISOString(),
  };
}

export async function extractLinkGraph(bundlePath: string, options: { includeTypedRelations?: boolean } = {}): Promise<KnowledgeMap> {
  const docs: SourceDoc[] = [];
  for (const file of await listMarkdownFiles(bundlePath)) {
    const path = normalizePath(relative(bundlePath, file));
    const raw = await readFile(file, 'utf8');
    const parsed = parse(raw);
    docs.push({
      id: parsed.frontmatter.slug ?? stripMarkdownExtension(path),
      title: parsed.frontmatter.title ?? parsed.frontmatter.slug ?? stripMarkdownExtension(path),
      path,
      type: parsed.frontmatter.type,
      tags: parsed.frontmatter.tags ?? [],
      markdown: parsed.body,
    });
  }
  return buildLinkGraph(docs, options);
}

export function knowledgeItemsToLinkGraph(items: KnowledgeItem[], options: { includeTypedRelations?: boolean } = {}): KnowledgeMap {
  return buildLinkGraph(
    items.map((item) => ({
      id: item.id,
      title: item.title,
      path: `${item.category}/${item.id}.md`,
      type: 'DOCUMENT',
      tags: item.aiTags,
      markdown: item.contentMarkdown,
    })),
    options,
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function renderKnowledgeMapHtml(graph: KnowledgeMap): string {
  const graphJson = JSON.stringify(graph).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>지식 맵</title>
  <style>
    body{font-family:Inter,system-ui,sans-serif;margin:0;background:#f8fafc;color:#172033}
    header{padding:20px 24px;background:#fff;border-bottom:1px solid #e5e7eb}
    main{display:grid;grid-template-columns:1fr 320px;gap:16px;padding:16px}
    .graph{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
    button{border:1px solid #d7dee8;background:#fff;border-radius:8px;padding:10px;text-align:left;cursor:pointer}
    button.on{border-color:#2563eb;box-shadow:0 0 0 2px #bfdbfe}
    aside{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:14px}
    .edge{font-size:13px;color:#475569;margin:6px 0}
    .tag{display:inline-block;margin:3px;padding:3px 7px;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:12px}
    input{width:100%;box-sizing:border-box;padding:9px;border:1px solid #d7dee8;border-radius:8px;margin-top:10px}
  </style>
</head>
<body>
  <header><h1>지식 맵</h1><p>${graph.nodes.length} nodes · ${graph.edges.length} edges</p><input id="q" placeholder="검색"></header>
  <main><section id="graph" class="graph"></section><aside id="detail"></aside></main>
  <script>
    const graph = ${graphJson};
    const graphEl = document.querySelector('#graph');
    const detailEl = document.querySelector('#detail');
    const q = document.querySelector('#q');
    let selected = graph.nodes[0]?.id;
    function render(){
      const needle = q.value.trim().toLowerCase();
      graphEl.innerHTML = graph.nodes.filter(n => !needle || (n.title + ' ' + n.path + ' ' + n.tags.join(' ')).toLowerCase().includes(needle)).map(n => '<button class="'+(n.id===selected?'on':'')+'" data-id="'+escapeHtml(n.id)+'"><strong>'+escapeHtml(n.title)+'</strong><br><small>'+escapeHtml(n.type)+' · '+n.backlinkCount+' backlinks</small></button>').join('');
      graphEl.querySelectorAll('button').forEach(b => b.onclick = () => { selected = b.dataset.id; render(); });
      const node = graph.nodes.find(n => n.id === selected) || graph.nodes[0];
      if (!node) { detailEl.innerHTML = '<p>노드가 없습니다.</p>'; return; }
      const related = graph.edges.filter(e => e.source === node.id || e.target === node.id);
      detailEl.innerHTML = '<h2>'+escapeHtml(node.title)+'</h2><p>'+escapeHtml(node.path)+'</p><div>'+node.tags.map(t=>'<span class="tag">#'+escapeHtml(t)+'</span>').join('')+'</div><h3>연결</h3>'+related.map(e=>'<div class="edge">'+escapeHtml(e.kind)+' · '+escapeHtml(e.label)+' · '+escapeHtml(e.source)+' → '+escapeHtml(e.target)+'</div>').join('');
    }
    function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
    q.oninput = render; render();
  </script>
</body>
</html>`;
}

export async function writeKnowledgeMapHtml(bundlePath: string, outputPath: string, options: { includeTypedRelations?: boolean } = {}): Promise<KnowledgeMap> {
  const graph = await extractLinkGraph(bundlePath, options);
  await writeFile(outputPath, renderKnowledgeMapHtml(graph), 'utf8');
  return graph;
}
