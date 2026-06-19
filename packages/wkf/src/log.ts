import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type LogKind = 'Creation' | 'Update' | 'Verify';
export type LogPipeline = 'A' | 'B' | 'C';

export interface AppendLogEntry {
  date?: Date | string;
  kind: LogKind;
  slug: string;
  summary: string;
  actor?: string;
  pipeline: LogPipeline;
}

function dateKey(value: Date | string | undefined): string {
  const date = value == null ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid log date: ${String(value)}`);
  return date.toISOString().slice(0, 10);
}

function entryLine(entry: AppendLogEntry): string {
  const actor = entry.actor ? ` 검토 ${entry.actor}.` : '';
  const summary = /[.!?。]$/.test(entry.summary.trim()) ? entry.summary.trim() : `${entry.summary.trim()}.`;
  return `- **${entry.kind}** ${entry.slug}: ${summary}${actor} [${entry.pipeline}]`;
}

function parseGroups(content: string): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  let current: string | undefined;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const heading = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(line);
    if (heading) {
      current = heading[1]!;
      groups.set(current, groups.get(current) ?? []);
      continue;
    }
    if (current && line.trim()) groups.get(current)!.push(line);
  }
  return groups;
}

function renderGroups(groups: Map<string, string[]>): string {
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, lines]) => [`## ${date}`, ...lines].join('\n'))
    .join('\n\n')
    .concat('\n');
}

export async function appendLog(dir: string, entry: AppendLogEntry): Promise<string> {
  const logPath = join(dir, 'log.md');
  await mkdir(dirname(logPath), { recursive: true });
  const current = await readFile(logPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const groups = parseGroups(current);
  const key = dateKey(entry.date);
  const line = entryLine(entry);
  const lines = groups.get(key) ?? [];
  if (!lines.includes(line)) {
    lines.push(line);
    groups.set(key, lines);
    await writeFile(logPath, renderGroups(groups), 'utf8');
  }
  return logPath;
}
