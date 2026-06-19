import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { parse } from './parse.js';

const RESERVED_MARKDOWN = new Set(['index.md', 'log.md']);

export interface GenerateIndexOptions {
  check?: boolean;
}

export interface GenerateIndexResult {
  written: string[];
  checked: string[];
  drifted: string[];
}

interface ChildEntry {
  kind: 'directory' | 'document';
  title: string;
  description?: string;
  type?: string;
  href: string;
}

interface DirectorySummary {
  path: string;
  title: string;
  description?: string;
  content: string;
  hasContent: boolean;
}

function relativeBundlePath(bundlePath: string, path: string): string {
  return relative(bundlePath, path).split(sep).join('/');
}

function titleFromSlug(value: string): string {
  return value
    .replace(/\.md$/i, '')
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

function entryLine(entry: ChildEntry): string {
  return `* [${entry.title}](${entry.href})${entry.description ? ` - ${entry.description}` : ''}`;
}

function renderIndex(entries: ChildEntry[]): string {
  const sections: string[] = [];
  const directories = entries.filter((entry) => entry.kind === 'directory');
  if (directories.length > 0) {
    sections.push(['# Subdirectories', ...directories.map(entryLine)].join('\n'));
  }

  const docs = entries.filter((entry) => entry.kind === 'document');
  const types = [...new Set(docs.map((entry) => entry.type ?? 'ENTITY'))].sort((a, b) => a.localeCompare(b));
  for (const type of types) {
    const group = docs.filter((entry) => (entry.type ?? 'ENTITY') === type);
    sections.push([`# ${type}`, ...group.map(entryLine)].join('\n'));
  }

  return `${sections.join('\n\n')}\n`;
}

async function readDocumentEntry(path: string): Promise<ChildEntry> {
  const raw = await readFile(path, 'utf8');
  const doc = parse(raw);
  return {
    kind: 'document',
    title: doc.frontmatter.title ?? titleFromSlug(basename(path)),
    ...(doc.frontmatter.description ? { description: doc.frontmatter.description } : {}),
    type: doc.frontmatter.type,
    href: basename(path),
  };
}

async function summarizeDirectory(bundlePath: string, dir: string): Promise<DirectorySummary> {
  const entries = await readdir(dir, { withFileTypes: true });
  const children: ChildEntry[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.wkf') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const child = await summarizeDirectory(bundlePath, path);
      if (!child.hasContent) continue;
      children.push({
        kind: 'directory',
        title: basename(path),
        ...(child.description ? { description: child.description } : {}),
        href: `${entry.name}/index.md`,
      });
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.md') || RESERVED_MARKDOWN.has(entry.name)) continue;
    children.push(await readDocumentEntry(path));
  }

  children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
  const content = children.length > 0 ? renderIndex(children) : '';
  const singleChildDescription = children.length === 1 ? children[0]?.description : undefined;
  return {
    path: dir,
    title: basename(dir),
    ...(singleChildDescription ? { description: singleChildDescription } : {}),
    content,
    hasContent: children.length > 0,
  };
}

async function collectDirectories(bundlePath: string, dir = bundlePath): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const dirs = [dir];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.wkf') continue;
    dirs.push(...(await collectDirectories(bundlePath, join(dir, entry.name))));
  }
  return dirs;
}

export async function generateIndexes(bundlePath: string, options: GenerateIndexOptions = {}): Promise<GenerateIndexResult> {
  const directories = await collectDirectories(bundlePath);
  const summaries = await Promise.all(directories.map((dir) => summarizeDirectory(bundlePath, dir)));
  const byPath = new Map(summaries.map((summary) => [summary.path, summary]));
  const result: GenerateIndexResult = { written: [], checked: [], drifted: [] };

  for (const dir of directories.sort((a, b) => relativeBundlePath(bundlePath, a).localeCompare(relativeBundlePath(bundlePath, b)))) {
    const summary = byPath.get(dir)!;
    const indexPath = join(dir, 'index.md');
    const relativePath = relativeBundlePath(bundlePath, indexPath) || 'index.md';
    const current = await readFile(indexPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    if (!summary.hasContent) {
      if (!current) continue;
      result.checked.push(relativePath);
      if (options.check) {
        result.drifted.push(relativePath);
        continue;
      }
      await rm(indexPath);
      result.written.push(relativePath);
      continue;
    }
    result.checked.push(relativePath);
    if (current === summary.content) continue;
    if (options.check) {
      result.drifted.push(relativePath);
      continue;
    }
    await writeFile(indexPath, summary.content, 'utf8');
    result.written.push(relativePath);
  }

  return result;
}
