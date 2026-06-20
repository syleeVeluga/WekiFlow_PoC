import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parse } from './parse.js';
import { defaultPolicy, loadPolicy, type Policy } from './policy.js';

const RESERVED_MARKDOWN = new Set(['index.md', 'log.md']);

export interface McpConceptSummary {
  slug: string;
  path: string;
  title?: string;
  type: string;
}

export interface McpProposal {
  id: string;
  slug: string;
  instruction: string;
  rationale?: string;
  status: 'REVIEW';
  createdAt: string;
}

export interface WkfMcpRequest {
  method: string;
  params?: unknown;
}

export interface WkfMcpResponse {
  content?: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface WkfMcpOptions {
  authToken?: string;
}

function normalizePath(path: string): string {
  return path.split(sep).join('/');
}

function slugFromPath(bundlePath: string, path: string): string {
  return normalizePath(relative(bundlePath, path)).replace(/\.md$/i, '');
}

async function listMarkdownFiles(bundlePath: string, dir = bundlePath): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === '.wkf' || entry.name === '.ref') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listMarkdownFiles(bundlePath, path)));
    if (entry.isFile() && entry.name.endsWith('.md') && !RESERVED_MARKDOWN.has(entry.name)) files.push(path);
  }
  return files.sort((a, b) => normalizePath(relative(bundlePath, a)).localeCompare(normalizePath(relative(bundlePath, b))));
}

function jsonText(value: unknown): WkfMcpResponse {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function paramString(params: unknown, key: string): string {
  if (!params || typeof params !== 'object') throw new Error(`${key} is required`);
  const value = (params as Record<string, unknown>)[key];
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${key} is required`);
  return value;
}

function optionalParamString(params: unknown, key: string): string | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const value = (params as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function requireToken(params: unknown, options: WkfMcpOptions): void {
  if (!options.authToken) return;
  if (optionalParamString(params, 'token') !== options.authToken) throw new Error('MCP token is required');
}

export async function listMcpConcepts(bundlePath: string, policy: Policy = defaultPolicy): Promise<McpConceptSummary[]> {
  const files = await listMarkdownFiles(bundlePath);
  const concepts: McpConceptSummary[] = [];
  for (const file of files) {
    const relPath = normalizePath(relative(bundlePath, file));
    const doc = parse(await readFile(file, 'utf8'));
    if (policy.conformance.reject_on_missing_type && !doc.frontmatter.type) continue;
    concepts.push({
      slug: doc.frontmatter.slug ?? slugFromPath(bundlePath, file),
      path: relPath,
      type: doc.frontmatter.type,
      ...(doc.frontmatter.title ? { title: doc.frontmatter.title } : {}),
    });
  }
  return concepts;
}

export async function lookupMcpConcept(bundlePath: string, slug: string): Promise<{ concept: McpConceptSummary; markdown: string }> {
  const concepts = await listMcpConcepts(bundlePath, await loadPolicy(bundlePath));
  const concept = concepts.find((entry) => entry.slug === slug || entry.path.replace(/\.md$/i, '') === slug);
  if (!concept) throw new Error(`Concept not found: ${slug}`);
  const markdown = await readFile(join(bundlePath, concept.path.split('/').join(sep)), 'utf8');
  return { concept, markdown };
}

export async function proposeMcpChange(
  bundlePath: string,
  input: { slug: string; instruction: string; rationale?: string },
  options: { now?: Date } = {},
): Promise<McpProposal> {
  await lookupMcpConcept(bundlePath, input.slug);
  const now = options.now ?? new Date();
  const proposal: McpProposal = {
    id: `mcp-${now.getTime()}`,
    slug: input.slug,
    instruction: input.instruction,
    status: 'REVIEW',
    createdAt: now.toISOString(),
    ...(input.rationale ? { rationale: input.rationale } : {}),
  };
  const path = join(bundlePath, '.wkf', 'mcp-proposals.jsonl');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(proposal)}\n`, { encoding: 'utf8', flag: 'a' });
  return proposal;
}

export async function handleWkfMcpRequest(bundlePath: string, request: WkfMcpRequest, options: WkfMcpOptions = {}): Promise<WkfMcpResponse> {
  if (request.method === 'tools/list') {
    return jsonText({
      tools: [
        {
          name: 'list_concepts',
          description: 'List readable WKF concepts in the bundle.',
          inputSchema: { type: 'object', properties: { token: { type: 'string' } } },
        },
        {
          name: 'lookup_concept',
          description: 'Read one WKF concept by slug.',
          inputSchema: { type: 'object', properties: { slug: { type: 'string' }, token: { type: 'string' } }, required: ['slug'] },
        },
        {
          name: 'propose_change',
          description: 'Queue a reviewed change proposal without writing concepts directly.',
          inputSchema: {
            type: 'object',
            properties: { slug: { type: 'string' }, instruction: { type: 'string' }, rationale: { type: 'string' }, token: { type: 'string' } },
            required: ['slug', 'instruction'],
          },
        },
      ],
    });
  }

  if (request.method === 'tools/call') {
    const name = paramString(request.params, 'name');
    const args = request.params && typeof request.params === 'object' ? (request.params as { arguments?: unknown }).arguments : undefined;
    requireToken(args, options);
    if (name === 'list_concepts') return jsonText(await listMcpConcepts(bundlePath, await loadPolicy(bundlePath)));
    if (name === 'lookup_concept') return jsonText(await lookupMcpConcept(bundlePath, paramString(args, 'slug')));
    if (name === 'propose_change') {
      return jsonText(
        await proposeMcpChange(bundlePath, {
          slug: paramString(args, 'slug'),
          instruction: paramString(args, 'instruction'),
          ...(args && typeof args === 'object' && typeof (args as Record<string, unknown>).rationale === 'string'
            ? { rationale: (args as Record<string, string>).rationale }
            : {}),
        }),
      );
    }
  }

  if (request.method === 'initialize') {
    return jsonText({ protocolVersion: '2024-11-05', serverInfo: { name: 'wkf', version: '0.1.0' }, capabilities: { tools: {} } });
  }
  throw new Error(`Unsupported MCP method: ${request.method}`);
}

export async function serveWkfMcp(bundlePath: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  for await (const line of rl) {
    const normalizedLine = line.replace(/^\uFEFF/, '');
    if (!normalizedLine.trim()) continue;
    const request = JSON.parse(normalizedLine) as { id?: unknown; method: string; params?: unknown };
    try {
      const result = await handleWkfMcpRequest(bundlePath, request, process.env.WKF_MCP_TOKEN ? { authToken: process.env.WKF_MCP_TOKEN } : {});
      console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id ?? null, result }));
    } catch (error) {
      console.log(
        JSON.stringify({
          jsonrpc: '2.0',
          id: request.id ?? null,
          error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
        }),
      );
    }
  }
}
