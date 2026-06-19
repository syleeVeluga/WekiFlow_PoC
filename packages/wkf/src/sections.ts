import type { Triplet } from './types.js';

const SECTION_HEADING = /^#\s+(.+?)\s*$/gm;
const RELATION_LINE = /^\s*-\s*\((?<subject>[^)]+)\)\s*-\[(?<predicate>[^\]]+)\]->\s*\((?<object>[^)]+)\)\s*(?:\{(?<options>[^}]*)\})?\s*$/;

export function extractSection(body: string, heading: string): string | undefined {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^#\\s+${escaped}\\s*$`, 'im');
  const match = pattern.exec(body);
  if (!match) return undefined;
  const start = match.index + match[0].length;
  const rest = body.slice(start);
  const next = /^#\s+.+?\s*$/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

function parseRelationOptions(raw: string | undefined): Pick<Triplet, 'strength' | 'ref'> {
  if (!raw) return {};
  const result: Pick<Triplet, 'strength' | 'ref'> = {};
  for (const part of raw.split(',')) {
    const [key, ...valueParts] = part.split(':');
    const value = valueParts.join(':').trim().replace(/^['"]|['"]$/g, '');
    if (key?.trim() === 'strength') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) result.strength = parsed;
    }
    if (key?.trim() === 'ref' && value) result.ref = value;
  }
  return result;
}

export function parseRelations(body: string): Triplet[] {
  const section = extractSection(body, 'Relations');
  if (!section) return [];
  const triplets: Triplet[] = [];

  for (const line of section.split(/\r?\n/)) {
    const match = RELATION_LINE.exec(line);
    if (!match?.groups) continue;
    triplets.push({
      subject: match.groups.subject!.trim(),
      predicate: match.groups.predicate!.trim(),
      object: match.groups.object!.trim(),
      ...parseRelationOptions(match.groups.options),
    });
  }

  return triplets;
}

export function serializeRelations(triplets: Triplet[]): string {
  if (triplets.length === 0) return '# Relations\n';
  const lines = triplets.map((triplet) => {
    const options: string[] = [];
    if (triplet.strength !== undefined) options.push(`strength: ${triplet.strength}`);
    if (triplet.ref) options.push(`ref: ${triplet.ref}`);
    return `- (${triplet.subject}) -[${triplet.predicate}]-> (${triplet.object})${options.length ? ` {${options.join(', ')}}` : ''}`;
  });
  return `# Relations\n${lines.join('\n')}\n`;
}

export function parseCitations(body: string): string[] {
  const section = extractSection(body, 'Citations');
  if (!section) return [];
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(\d+\.|\[[^\]]+\]|\-|\*)\s+/.test(line));
}

export function extractHeadings(body: string): string[] {
  return [...body.matchAll(SECTION_HEADING)].map((match) => match[1]!.trim());
}
