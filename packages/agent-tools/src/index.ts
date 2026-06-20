import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';
import { cosineSimilarity, generateObject, tool, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { Db } from 'mongodb';
import { createChunksRepo, createDocumentsRepo, searchKnowledgeGraph, type GraphPath } from '@wf/db';
import { appendLog, assertNoShrinkage, parse, parseCitations, serialize, type Policy, type StaleConcept, type WkfDoc } from '@wekiflow/wkf';
import {
  MergeResultSchema,
  TripletArraySchema,
  type DocumentDTO,
  type EmbedFn,
  type Triplet,
  type VectorHit,
} from '@wf/shared';
import type { SandboxRunner } from '@wf/sandbox';
import { decomposeQuestion, rerankDiscoveryContexts } from './discovery.js';
import { createFetchUrlState, toolFetchUrl } from './fetchUrl.js';

export type { EmbedFn } from '@wf/shared';

export interface AgentStep {
  tool: string;
  args: unknown;
  result?: unknown;
  tookMs?: number;
}

export interface MainToolContext {
  db: Db;
  sandbox: SandboxRunner;
  /** Host directory mounted read-only at /docs inside the sandbox. */
  docsSnapshotDir: string;
  jobId: string;
  /** The document being ingested. tool_merge always targets this id (never one chosen by the model). */
  documentId: string;
  embed: EmbedFn;
  /** Model used by tool_merge to synthesise the merged draft. */
  model: LanguageModel;
  /** Enable LLM question decomposition before hybrid retrieval. Off by default to preserve ingest loop determinism. */
  decomposeHybridRetrieve?: boolean;
  recordStep?: (step: AgentStep) => void | Promise<void>;
}

export interface CurationToolContext {
  db: Db;
  sandbox: SandboxRunner;
  /** Bundle root; concept paths are resolved relative to this directory. */
  bundlePath: string;
  /** Host directory mounted read-only at /docs inside the sandbox. */
  docsSnapshotDir: string;
  concept: StaleConcept;
  policy: Policy;
  now?: Date;
  recordStep?: (step: AgentStep) => void | Promise<void>;
}

/** Single-quote a value for safe interpolation into a `bash -lc` command (no shell expansion). */
function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function resolveBundlePath(bundlePathRoot: string, relativePath: string): string {
  return join(bundlePathRoot, relativePath.split('/').join(sep));
}

function conceptDir(bundlePathRoot: string, relativePath: string): string {
  return join(bundlePathRoot, dirname(relativePath.split('/').join(sep)));
}

function conceptFileName(relativePath: string): string {
  return basename(relativePath.split('/').join(sep));
}

function parseDraftWithFallback(markdown: string, before: WkfDoc): WkfDoc {
  try {
    return parse(markdown);
  } catch {
    return { frontmatter: before.frontmatter, body: markdown };
  }
}

export const MAIN_AGENT_SYSTEM_PROMPT = `너는 WekiFlow의 지식 병합 에이전트다. 목표는 인입된 정보를 기존 문서에 정확히 병합하는 것이다.
원칙:
1) 절대 추측하지 마라. 수치·규정번호·고유명사가 불확실하면 tool_execute_sandbox_terminal로 rg/grep을 실행해 원본(/docs)에서 직접 확인하라.
2) 의미적 맥락은 tool_search_vector로, 규정 간 관계는 tool_search_graph로 보강하라.
3) 충분한 팩트가 모이면 tool_merge로 병합 초안을 만들어라.
4) 병합 후 반드시 tool_verify_integrity로 핵심 주장(수치/조항)을 자가 검증하라. 미검증 항목이 있으면 다시 grep으로 확인 후 수정하라.
5) 최종 결과는 사람이 Monaco Diff로 검토할 것이므로 변경 요약(changeSummary)을 남겨라.
도구는 필요할 때만, 최소 횟수로 호출하라.

Phase 4 retrieval guide:
- For relationship questions, start with tool_search_graph or tool_hybrid_retrieve using the most concrete startEntity in the user/document text.
- Prefer tool_hybrid_retrieve when both semantically similar chunks and knowledge-graph paths are useful; it returns RRF-ranked context from vector and graph retrieval.
- If graph paths are sparse, fall back to tool_search_vector and finally tool_execute_sandbox_terminal for exact clauses, numbers, and policy wording.
- Pass graph path facts into tool_merge as evidence when they explain relationships across documents.`;

export const CURATION_SYSTEM_PROMPT = `You are WekiFlow's knowledge curation agent. Keep the assigned concept current without destructive rewrites.

Rules:
1. First read the concept and its read-only reference context with tool_read_concept.
2. Verify source facts with tool_grep_verify before deciding. If the source facts are unchanged, do not rewrite the document; call tool_write_concept with decision "verify".
3. If facts changed, only produce additive updates. Preserve existing frontmatter keys, keep type/title/resource verbatim, union tags, and preserve every existing # heading in the same order and wording.
4. If the topic does not clearly belong in the existing concept, use decision "create" only when the new reference is concrete, non-meta, citeable, and reusable. Otherwise use decision "skip".
5. For external web sources, call tool_fetch_url. The tool enforces allowed_hosts and web_max_pages. Do not retry rejected URLs.
6. When in doubt, skip. Only cite sources that were actually read or verified.`;

const MERGE_SYSTEM_PROMPT = `너는 사내 지식 문서 편집기다. 기존 문서(original)에 수집된 팩트(facts)를 정확히 병합한 마크다운 초안을 만든다.
규칙:
1) facts에 명시된 수치·조항·고유명사를 그대로 사용하고, 근거 없는 내용을 창작하지 마라.
2) 기존 문서의 구조와 어조를 유지하되, 신규 정보를 적절한 섹션에 통합하라.
3) mergedMarkdown에는 완성된 문서 전문을, changeSummary에는 무엇이 어떻게 바뀌었는지 한국어 요약을 담아라.`;

export function buildIngestPrompt(doc: Pick<DocumentDTO, 'id' | 'title' | 'contentMarkdown'>): string {
  return `새로 인입된 문서를 검토하여 기존 지식 베이스에 병합할 초안을 작성하라.

제목: ${doc.title}
문서 ID: ${doc.id}
원본 내용은 /docs 디렉터리에 read-only로 마운트되어 있으며 tool_execute_sandbox_terminal로 직접 확인할 수 있다.

--- 인입 문서 내용 ---
${doc.contentMarkdown}
--- 끝 ---

수치·조항·고유명사는 추측하지 말고 grep으로 검증한 뒤, tool_merge로 병합 초안을 만들고 tool_verify_integrity로 핵심 주장을 검증하라.`;
}

export function buildCurationPrompt(concept: StaleConcept): string {
  return `Curate this stale WKF concept once.

Slug: ${concept.slug}
Path: ${concept.path}
Type: ${concept.type}
Last checked: ${concept.lastCheckedAt ?? 'never'}
Stale since: ${concept.staleSince}

Use the tools to read the current concept, grep-verify source facts, then choose exactly one write decision: verify, enhance, create, or skip.`;
}

export interface HybridContext {
  source: 'vector' | 'graph';
  content: string;
  score: number;
  documentId?: string;
  headingPath?: string[];
  path?: GraphPath;
  ranks: { vector?: number; graph?: number };
}

function graphPathContent(path: GraphPath): string {
  return path.edges
    .map((edge) => `${edge.subject} -[${edge.predicate}, strength=${edge.strength}]-> ${edge.object}`)
    .join(' | ');
}

function citationUrls(markdown: string): string[] {
  return parseCitations(markdown)
    .flatMap((line) => [...line.matchAll(/https?:\/\/[^\s)>\]]+/g)].map((match) => match[0]!))
    .map((url) => url.replace(/[.,;:]+$/g, ''));
}

function rrf(rank: number, constant = 60): number {
  return 1 / (constant + rank);
}

// Vector hits (chunks) and graph paths are heterogeneous — a chunk and a path are never the
// "same item", so their keys never collide and each context carries exactly one rank. This is
// therefore not cross-source rank fusion (where agreement between retrievers boosts a result);
// it is an RRF-weighted interleave of two independently-ranked lists. Equal ranks tie, and
// vector hits win ties by insertion order. Adequate for combining two disjoint sources; do not
// rely on it to reward vector+graph agreement.
export function fuseHybridRetrieval(input: {
  vectorHits: VectorHit[];
  graphPaths: GraphPath[];
  k?: number;
}): HybridContext[] {
  const fused = new Map<string, HybridContext>();

  input.vectorHits.forEach((hit, index) => {
    const rank = index + 1;
    const key = `vector:${hit.documentId}:${hit.headingPath.join('/')}:${hit.text}`;
    fused.set(key, {
      source: 'vector',
      content: hit.text,
      documentId: hit.documentId,
      headingPath: hit.headingPath,
      score: rrf(rank),
      ranks: { vector: rank },
    });
  });

  input.graphPaths.forEach((path, index) => {
    const rank = index + 1;
    const content = graphPathContent(path);
    const key = `graph:${path.nodes.join('>')}:${content}`;
    fused.set(key, {
      source: 'graph',
      content,
      path,
      score: rrf(rank),
      ranks: { graph: rank },
    });
  });

  return [...fused.values()].sort((a, b) => b.score - a.score).slice(0, input.k ?? 8);
}

export function createCurationTools(ctx: CurationToolContext) {
  const documents = createDocumentsRepo(ctx.db);
  const fetchState = createFetchUrlState();

  const record = async (step: AgentStep) => {
    await ctx.recordStep?.(step);
  };

  const conceptPath = () => resolveBundlePath(ctx.bundlePath, ctx.concept.path);
  const referencePath = () => resolveBundlePath(join(ctx.bundlePath, '.ref'), ctx.concept.path);

  return {
    tool_read_concept: tool({
      description: 'Read the current WKF concept and its read-only reference baseline.',
      inputSchema: z.object({}),
      execute: async () => {
        const started = Date.now();
        const currentMarkdown = await readFile(conceptPath(), 'utf8');
        const referenceMarkdown = await readFile(referencePath(), 'utf8').catch(() => '');
        await record({
          tool: 'tool_read_concept',
          args: { slug: ctx.concept.slug, path: ctx.concept.path },
          result: { hasReference: referenceMarkdown.length > 0, referenceReadOnly: true },
          tookMs: Date.now() - started,
        });
        return {
          slug: ctx.concept.slug,
          path: ctx.concept.path,
          currentMarkdown,
          referenceMarkdown,
          referenceReadOnly: true,
        };
      },
    }),

    tool_grep_verify: tool({
      description: 'Run a fixed-string rg check against the read-only /docs snapshot.',
      inputSchema: z.object({
        query: z.string().min(1),
        timeoutMs: z.number().int().min(1_000).max(30_000).default(10_000),
      }),
      execute: async ({ query, timeoutMs }) => {
        const started = Date.now();
        const result = await ctx.sandbox.run({
          language: 'bash',
          code: `rg -n -F -- ${shSingleQuote(query)} /docs`,
          docsSnapshotDir: ctx.docsSnapshotDir,
          timeoutMs,
        });
        await record({
          tool: 'tool_grep_verify',
          args: { query, timeoutMs },
          result: { exitCode: result.exitCode, truncated: result.truncated },
          tookMs: Date.now() - started,
        });
        return result;
      },
    }),

    tool_fetch_url: tool({
      description: 'Fetch one external URL. Enforces policy.sources.allowed_hosts, policy.enrichment.web_max_pages, and rejected URL no-retry.',
      inputSchema: z.object({
        url: z.string().url(),
      }),
      execute: async ({ url }) => {
        const started = Date.now();
        const result = await toolFetchUrl(url, ctx.policy, fetchState);
        await record({
          tool: 'tool_fetch_url',
          args: { url },
          result: {
            status: result.status,
            reason: result.reason,
            fetchedCount: result.fetchedCount,
            finalUrl: result.finalUrl,
            contentType: result.contentType,
          },
          tookMs: Date.now() - started,
        });
        return result;
      },
    }),

    tool_write_concept: tool({
      description: 'Record the curation decision. verify only updates last_verified; enhance/create moves additive drafts to REVIEW; skip writes nothing.',
      inputSchema: z.object({
        decision: z.enum(['verify', 'enhance', 'create', 'skip']),
        mergedMarkdown: z.string().optional(),
        changeSummary: z.string().optional(),
        createdSlug: z.string().optional(),
        createdTitle: z.string().optional(),
      }),
      execute: async ({ decision, mergedMarkdown, changeSummary, createdSlug, createdTitle }) => {
        const started = Date.now();
        if (decision === 'skip') {
          await record({
            tool: 'tool_write_concept',
            args: { decision, slug: ctx.concept.slug },
            result: { status: 'skipped' },
            tookMs: Date.now() - started,
          });
          return { decision, status: 'skipped' as const };
        }

        if (decision === 'verify') {
          const markdown = await readFile(conceptPath(), 'utf8');
          const doc = parse(markdown);
          const verifiedAt = (ctx.now ?? new Date()).toISOString();
          await writeFile(
            conceptPath(),
            serialize({ ...doc, frontmatter: { ...doc.frontmatter, last_verified: verifiedAt } }),
            'utf8',
          );
          await appendLog(conceptDir(ctx.bundlePath, ctx.concept.path), {
            date: verifiedAt,
            kind: 'Verify',
            slug: conceptFileName(ctx.concept.path),
            summary: '변경 없음, 재검증 완료',
            pipeline: 'C',
          });
          await record({
            tool: 'tool_write_concept',
            args: { decision, slug: ctx.concept.slug },
            result: { status: 'verified', lastVerified: verifiedAt },
            tookMs: Date.now() - started,
          });
          return { decision, status: 'verified' as const, lastVerified: verifiedAt };
        }

        if (!mergedMarkdown?.trim()) throw new Error(`${decision} requires mergedMarkdown`);
        const urls = citationUrls(mergedMarkdown);
        const existingUrls =
          decision === 'enhance'
            ? new Set(citationUrls((await readFile(conceptPath(), 'utf8').catch(() => '')).toString()))
            : new Set<string>();
        const inventedUrl = urls.find((url) => !fetchState.fetchedUrls.has(url) && !existingUrls.has(url));
        if (inventedUrl) {
          const reason = 'External citations must be actual fetched URLs';
          await record({
            tool: 'tool_write_concept',
            args: { decision, slug: ctx.concept.slug, changeSummary },
            result: { status: 'rejected', reason, url: inventedUrl },
            tookMs: Date.now() - started,
          });
          throw new Error(reason);
        }
        const fetchedCitation = urls.find((url) => fetchState.fetchedUrls.has(url));
        if (decision === 'enhance') {
          const before = parse(await readFile(conceptPath(), 'utf8'));
          const after = parseDraftWithFallback(mergedMarkdown, before);
          try {
            assertNoShrinkage(before, after);
          } catch (error) {
            await record({
              tool: 'tool_write_concept',
              args: { decision, slug: ctx.concept.slug, changeSummary },
              result: { status: 'rejected', reason: error instanceof Error ? error.message : String(error) },
              tookMs: Date.now() - started,
            });
            throw error;
          }
          const updated = await documents.setDraftBySlug(ctx.concept.slug, mergedMarkdown);
          if (!updated) throw new Error(`Document not found for curation slug: ${ctx.concept.slug}`);
          await appendLog(conceptDir(ctx.bundlePath, ctx.concept.path), {
            kind: 'Update',
            slug: conceptFileName(ctx.concept.path),
            summary: changeSummary ?? '큐레이션 보강 초안 생성',
            pipeline: 'C',
          });
          await record({
            tool: 'tool_write_concept',
            args: { decision, slug: ctx.concept.slug, changeSummary },
            result: { status: 'review', documentId: updated.id },
            tookMs: Date.now() - started,
          });
          return { decision, status: 'review' as const, documentId: updated.id };
        }

        if (fetchedCitation && createdSlug && !createdSlug.startsWith('references/')) {
          const reason = 'External create drafts must be stored under references/';
          await record({
            tool: 'tool_write_concept',
            args: { decision, slug: createdSlug, changeSummary },
            result: { status: 'rejected', reason },
            tookMs: Date.now() - started,
          });
          throw new Error(reason);
        }
        const created = await documents.createDraft({
          title: createdTitle ?? createdSlug ?? ctx.concept.slug,
          contentMarkdown: mergedMarkdown,
          ...(createdSlug ? { slug: createdSlug } : {}),
          sourceType: fetchedCitation ? 'datasource' : 'manual',
          sourceRef: fetchedCitation ?? `wkf://${createdSlug ?? ctx.concept.slug}`,
          sourceLabel: fetchedCitation ?? 'curation',
        });
        await documents.setDraft(created.id, mergedMarkdown);
        await appendLog(conceptDir(ctx.bundlePath, ctx.concept.path), {
          kind: 'Creation',
          slug: `${createdSlug ?? ctx.concept.slug}.md`,
          summary: changeSummary ?? '큐레이션 신규 reference 초안 생성',
          pipeline: 'C',
        });
        await record({
          tool: 'tool_write_concept',
          args: { decision, slug: createdSlug ?? ctx.concept.slug, changeSummary },
          result: { status: 'review', documentId: created.id },
          tookMs: Date.now() - started,
        });
        return { decision, status: 'review' as const, documentId: created.id };
      },
    }),
  };
}

export function createMainTools(ctx: MainToolContext) {
  const chunks = createChunksRepo(ctx.db);
  const documents = createDocumentsRepo(ctx.db);

  const record = async (step: AgentStep) => {
    await ctx.recordStep?.(step);
  };

  const searchVector = async (query: string, k: number, documentId?: string): Promise<VectorHit[]> => {
    const [queryEmbedding] = await ctx.embed([query]);
    const rows = await chunks.listForSearch(documentId);
    return rows
      .filter((row) => queryEmbedding != null && row.embedding.length === queryEmbedding.length)
      .map((row) => ({
        text: row.text,
        documentId: row.documentId,
        headingPath: row.headingPath,
        score: cosineSimilarity(queryEmbedding!, row.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  };

  const retrieveHybrid = async (input: {
    query: string;
    startEntity?: string;
    k: number;
    maxDepth: number;
    predicates?: string[];
    documentId?: string;
  }) => {
    const vectorHits = await searchVector(input.query, input.k, input.documentId);
    const graph = input.startEntity
      ? await searchKnowledgeGraph(ctx.db, {
          startEntity: input.startEntity,
          maxDepth: input.maxDepth,
          pathLimit: input.k,
          ...(input.predicates ? { predicates: input.predicates } : {}),
        })
      : { paths: [], startNodes: [], exactMatch: false };
    return { vectorHits, graph, contexts: fuseHybridRetrieval({ vectorHits, graphPaths: graph.paths, k: input.k }) };
  };

  return {
    tool_search_vector: tool({
      description: '의미론적으로 유사한 문서 청크를 벡터 유사도로 탐색한다.',
      inputSchema: z.object({
        query: z.string().describe('검색 의도(자연어)'),
        k: z.number().int().min(1).max(50).default(8),
        documentId: z.string().optional(),
      }),
      execute: async ({ query, k, documentId }) => {
        const started = Date.now();
        const results = await searchVector(query, k, documentId);
        await record({
          tool: 'tool_search_vector',
          args: { query, k, documentId },
          result: { count: results.length, topScore: results[0]?.score ?? null },
          tookMs: Date.now() - started,
        });
        return { results };
      },
    }),

    tool_hybrid_retrieve: tool({
      description:
        'Vector chunks and knowledge-graph paths are retrieved and fused with reciprocal rank fusion for hybrid RAG context.',
      inputSchema: z.object({
        query: z.string(),
        startEntity: z.string().optional(),
        k: z.number().int().min(1).max(20).default(8),
        maxDepth: z.number().int().min(1).max(3).default(2),
        predicates: z.array(z.string()).optional(),
        documentId: z.string().optional(),
      }),
      execute: async ({ query, startEntity, k, maxDepth, predicates, documentId }) => {
        const started = Date.now();
        const queries = ctx.decomposeHybridRetrieve ? await decomposeQuestion(ctx.model, query).catch(() => [query]) : [query];
        const batches = await Promise.all(
          queries.map(async (nextQuery) => ({
            query: nextQuery,
            ...(await retrieveHybrid({
              query: nextQuery,
              k,
              maxDepth,
              ...(startEntity ? { startEntity } : {}),
              ...(predicates ? { predicates } : {}),
              ...(documentId ? { documentId } : {}),
            })),
          })),
        );
        const contexts = rerankDiscoveryContexts(
          batches.map((batch) => ({ query: batch.query, contexts: batch.contexts })),
          k,
        );
        const vectorHits = batches.flatMap((batch) => batch.vectorHits);
        const graphPaths = batches.flatMap((batch) => batch.graph.paths);
        const graph = batches[0]?.graph ?? { paths: [], startNodes: [], exactMatch: false };
        await record({
          tool: 'tool_hybrid_retrieve',
          args: { query, startEntity, k, maxDepth, predicates, documentId },
          result: {
            queryCount: queries.length,
            vectorCount: vectorHits.length,
            graphPathCount: graphPaths.length,
            fusedCount: contexts.length,
            exactGraphStartMatch: graph.exactMatch,
          },
          tookMs: Date.now() - started,
        });
        return { contexts, graphStartNodes: graph.startNodes, exactGraphStartMatch: graph.exactMatch };
      },
    }),

    tool_execute_sandbox_terminal: tool({
      description:
        '격리된 Docker 컨테이너에서 bash/python을 실행한다. 예) rg -n "제4조 2항" /docs. 원본 문서는 /docs에 마운트됨.',
      inputSchema: z.object({
        language: z.enum(['bash', 'python']).default('bash'),
        code: z.string().describe('실행할 명령 또는 스크립트'),
        timeoutMs: z.number().int().min(1_000).max(30_000).default(10_000),
      }),
      execute: async ({ language, code, timeoutMs }) => {
        const started = Date.now();
        const result = await ctx.sandbox.run({
          language,
          code,
          docsSnapshotDir: ctx.docsSnapshotDir,
          timeoutMs,
        });
        await record({
          tool: 'tool_execute_sandbox_terminal',
          args: { language, code, timeoutMs },
          result: { exitCode: result.exitCode, truncated: result.truncated },
          tookMs: Date.now() - started,
        });
        return result;
      },
    }),

    tool_merge: tool({
      description: '수집된 팩트를 근거로 기존 문서에 신규 정보를 병합한 초안 마크다운을 생성한다.',
      // documentId is fixed server-side (ctx.documentId) — the model only supplies facts.
      inputSchema: z.object({
        facts: z.array(z.object({ source: z.string(), content: z.string() })),
        instruction: z.string().optional(),
      }),
      execute: async ({ facts, instruction }) => {
        const started = Date.now();
        const doc = await documents.getById(ctx.documentId);
        const original = doc?.contentMarkdown ?? '';
        const factsBlock = facts.map((f, i) => `${i + 1}. [${f.source}] ${f.content}`).join('\n');
        const { object } = await generateObject({
          model: ctx.model,
          schema: MergeResultSchema,
          system: MERGE_SYSTEM_PROMPT,
          prompt: `--- 기존 문서 (original) ---\n${original}\n--- 끝 ---\n\n--- 수집된 팩트 (facts) ---\n${factsBlock}\n--- 끝 ---\n\n${instruction ? `추가 지시: ${instruction}\n\n` : ''}위 팩트를 반영한 병합 초안을 작성하라.`,
        });
        await record({
          tool: 'tool_merge',
          args: { documentId: ctx.documentId, factCount: facts.length, instruction },
          result: { changeSummary: object.changeSummary },
          tookMs: Date.now() - started,
        });
        return object;
      },
    }),

    tool_verify_integrity: tool({
      description:
        '병합 초안의 핵심 주장(수치/조항)이 원본(/docs)에 실제로 존재하는지 grep으로 자가 검증한다.',
      inputSchema: z.object({
        documentId: z.string(),
        draftMarkdown: z.string(),
        claims: z.array(z.string()).describe('검증할 핵심 주장/수치/조항'),
      }),
      execute: async ({ claims }) => {
        const started = Date.now();
        const results = [];
        for (const claim of claims) {
          const run = await ctx.sandbox.run({
            language: 'bash',
            // Single-quote the claim so the shell never expands $(), backticks, or $VARs in it,
            // and `--` stops a claim that starts with `-` from being read as an rg flag.
            code: `rg -n -F -- ${shSingleQuote(claim)} /docs`,
            docsSnapshotDir: ctx.docsSnapshotDir,
            timeoutMs: 8_000,
          });
          const verified = run.exitCode === 0 && run.stdout.trim().length > 0;
          results.push({ claim, verified, evidence: run.stdout.trim().slice(0, 500) });
        }
        const allVerified = results.length > 0 && results.every((r) => r.verified);
        await record({
          tool: 'tool_verify_integrity',
          args: { claimCount: claims.length },
          result: { allVerified, results },
          tookMs: Date.now() - started,
        });
        return { results, allVerified };
      },
    }),

    tool_search_graph: tool({
      description: '지식 그래프에서 시작 엔티티로부터 멀티홉 관계를 탐색한다.',
      inputSchema: z.object({
        startEntity: z.string(),
        maxDepth: z.number().int().min(1).max(3).default(2),
        predicates: z.array(z.string()).optional(),
      }),
      execute: async ({ startEntity, maxDepth, predicates }) => {
        const started = Date.now();
        const result = await searchKnowledgeGraph(ctx.db, {
          startEntity,
          maxDepth,
          ...(predicates ? { predicates } : {}),
        });
        await record({
          tool: 'tool_search_graph',
          args: { startEntity, maxDepth, predicates },
          result: {
            pathCount: result.paths.length,
            startNodes: result.startNodes.map((node) => node.name),
            exactMatch: result.exactMatch,
          },
          tookMs: Date.now() - started,
        });
        return result;
      },
    }),
  };
}

export function extractTripletsDeterministic(markdown: string): { triplets: Triplet[] } {
  const triplets: Triplet[] = [];

  if (markdown.includes('신입사원') && markdown.includes('연차 15일')) {
    triplets.push({
      subject: '신입사원',
      predicate: '부여받는다',
      object: '연차 15일',
      subjectType: 'PERSON',
      objectType: 'REGULATION',
      strength: 0.9,
    });
  }

  if (markdown.includes('연차 사용 신청') && markdown.includes('부서장')) {
    triplets.push({
      subject: '연차 사용 신청',
      predicate: '결재권자',
      object: '부서장',
      subjectType: 'POLICY',
      objectType: 'PERSON',
      strength: 0.95,
    });
  }

  return TripletArraySchema.parse({ triplets });
}

export {
  createFetchUrlState,
  toolFetchUrl,
  type FetchUrlResult,
  type FetchUrlState,
} from './fetchUrl.js';

export {
  ConnectorNotConfiguredError,
  StaticSource,
  StubSource,
  createConnector,
  createDefaultConnectors,
  type ConnectorKind,
  type Source,
  type SourceDocument,
  type SourceRef,
} from './connectors/index.js';

export {
  DISCOVERY_DECOMPOSE_PROMPT,
  DISCOVERY_SYSTEM_PROMPT,
  DiscoveryDecompositionSchema,
  askDiscovery,
  createDiscoveryAgent,
  decomposeQuestion,
  discoveryAgentAsTool,
  rerankDiscoveryContexts,
  type DiscoveryAgentContext,
  type DiscoveryDecomposition,
} from './discovery.js';

export {
  LEARNER_JUDGE_PROMPT,
  LearnerGapTypeSchema,
  TrajectoryAnalysisResultSchema,
  WkfEnrichmentProposalSchema,
  judgeTrajectory,
  redactPii,
  summarizeSteps,
  type TrajectoryAnalysisResult,
  type WkfEnrichmentProposal,
} from './learner.js';
