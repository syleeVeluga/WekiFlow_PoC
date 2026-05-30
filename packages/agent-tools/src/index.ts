import { cosineSimilarity, generateObject, tool, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { Db } from 'mongodb';
import { createChunksRepo, createDocumentsRepo } from '@wf/db';
import {
  MergeResultSchema,
  TripletArraySchema,
  type DocumentDTO,
  type Triplet,
} from '@wf/shared';
import type { SandboxRunner } from '@wf/sandbox';

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

export interface AgentStep {
  tool: string;
  args: unknown;
  result?: unknown;
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
  recordStep?: (step: AgentStep) => void | Promise<void>;
}

/** Single-quote a value for safe interpolation into a `bash -lc` command (no shell expansion). */
function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export const MAIN_AGENT_SYSTEM_PROMPT = `너는 WekiFlow의 지식 병합 에이전트다. 목표는 인입된 정보를 기존 문서에 정확히 병합하는 것이다.
원칙:
1) 절대 추측하지 마라. 수치·규정번호·고유명사가 불확실하면 tool_execute_sandbox_terminal로 rg/grep을 실행해 원본(/docs)에서 직접 확인하라.
2) 의미적 맥락은 tool_search_vector로, 규정 간 관계는 tool_search_graph로 보강하라.
3) 충분한 팩트가 모이면 tool_merge로 병합 초안을 만들어라.
4) 병합 후 반드시 tool_verify_integrity로 핵심 주장(수치/조항)을 자가 검증하라. 미검증 항목이 있으면 다시 grep으로 확인 후 수정하라.
5) 최종 결과는 사람이 Monaco Diff로 검토할 것이므로 변경 요약(changeSummary)을 남겨라.
도구는 필요할 때만, 최소 횟수로 호출하라.`;

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

export function createMainTools(ctx: MainToolContext) {
  const chunks = createChunksRepo(ctx.db);
  const documents = createDocumentsRepo(ctx.db);

  const record = async (step: AgentStep) => {
    await ctx.recordStep?.(step);
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
        const [queryEmbedding] = await ctx.embed([query]);
        const rows = await chunks.listForSearch(documentId);
        const results = rows
          .filter((row) => queryEmbedding != null && row.embedding.length === queryEmbedding.length)
          .map((row) => ({
            text: row.text,
            documentId: row.documentId,
            headingPath: row.headingPath,
            score: cosineSimilarity(queryEmbedding!, row.embedding),
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, k);
        await record({
          tool: 'tool_search_vector',
          args: { query, k, documentId },
          result: { count: results.length, topScore: results[0]?.score ?? null },
        });
        return { results };
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
        });
        return { results, allVerified };
      },
    }),

    // ⏸️ Phase 4에서 활성화. 그래프가 비어 있어도 안전하게 빈 결과 반환.
    tool_search_graph: tool({
      description: '지식 그래프에서 시작 엔티티로부터 멀티홉 관계를 탐색한다. (Phase 4에서 활성화)',
      inputSchema: z.object({
        startEntity: z.string(),
        maxDepth: z.number().int().min(1).max(3).default(2),
        predicates: z.array(z.string()).optional(),
      }),
      execute: async ({ startEntity, maxDepth }) => {
        await record({ tool: 'tool_search_graph', args: { startEntity, maxDepth }, result: { paths: [] } });
        return { paths: [] as Array<{ nodes: string[]; edges: unknown[] }> };
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
