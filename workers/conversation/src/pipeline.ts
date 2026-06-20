import type { Db } from 'mongodb';
import { extractConversationCandidates } from '@wf/agent-tools';
import { getConnector } from '@wf/connectors';
import { createCandidateRepository } from '@wf/db';
import type { ConversationIngestRequest, KnowledgeCandidate } from '@wf/shared';

export interface ConversationIngestContext {
  db: Db;
}

export interface ConversationIngestResult {
  candidates: KnowledgeCandidate[];
  sourceRef: string;
}

async function resolveTranscript(input: ConversationIngestRequest): Promise<{ transcript: string; sourceRef: string; sourceLabel?: string }> {
  if (input.transcript?.trim()) {
    return { transcript: input.transcript, sourceRef: input.ref ?? 'conversation://manual', sourceLabel: 'Manual conversation' };
  }
  if (!input.ref) throw new Error('Conversation ingest requires transcript or ref');
  if (input.source === 'manual') throw new Error('Manual conversation ingest requires transcript');
  const connector = getConnector(input.source === 'slack' ? 'slack' : 'meeting');
  const fetched = await connector.fetch(input.ref);
  const sourceLabel = fetched.ref.title ?? fetched.provenance.label;
  return {
    transcript: fetched.text,
    sourceRef: fetched.ref.ref,
    ...(sourceLabel ? { sourceLabel } : {}),
  };
}

export async function runConversationIngest(
  input: ConversationIngestRequest,
  ctx: ConversationIngestContext,
): Promise<ConversationIngestResult> {
  const repo = createCandidateRepository(ctx.db);
  const resolved = await resolveTranscript(input);
  const drafts = extractConversationCandidates(resolved.transcript, {
    sourceRef: resolved.sourceRef,
    ...(resolved.sourceLabel ? { sourceLabel: resolved.sourceLabel } : {}),
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
  });
  const candidates = [];
  for (const draft of drafts) {
    candidates.push(await repo.createCandidate(draft));
  }
  return { candidates, sourceRef: resolved.sourceRef };
}
