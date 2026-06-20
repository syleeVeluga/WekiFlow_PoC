import type { CreateKnowledgeCandidate, RiskFactor } from '@wf/shared';
import { detectRiskFactors } from './disposition.js';

export interface ConversationSegment {
  speaker: string;
  quote: string;
}

export interface ConversationExtractionOptions {
  sourceRef: string;
  sourceLabel?: string;
  workspaceId?: string;
}

export interface ConversationCandidateDraft {
  kind: 'decision' | 'policy_statement' | 'faq' | 'todo';
  title: string;
  summary: string;
  bodyMarkdown: string;
  speaker: string;
  quote: string;
  riskFactors: RiskFactor[];
}

const decisionPattern = /decision|decided|approved|결정|확정|승인/i;
const todoPattern = /todo|follow up|해야|필요|액션|조치/i;
const faqPattern = /\?|질문|문의|asked/i;

export function parseConversationTranscript(transcript: string): ConversationSegment[] {
  return transcript
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [speaker, ...quoteParts] = line.split(':');
      const quote = quoteParts.join(':').trim();
      return quote ? { speaker: speaker?.trim() || 'Unknown', quote } : { speaker: 'Unknown', quote: line };
    });
}

function classifySegment(segment: ConversationSegment): ConversationCandidateDraft | undefined {
  const riskFactors = detectRiskFactors(segment.quote);
  const isPolicyStatement = riskFactors.length > 0;
  const kind = decisionPattern.test(segment.quote)
    ? 'decision'
    : isPolicyStatement
      ? 'policy_statement'
      : faqPattern.test(segment.quote)
        ? 'faq'
        : todoPattern.test(segment.quote)
          ? 'todo'
          : undefined;
  if (!kind) return undefined;

  const titlePrefix: Record<ConversationCandidateDraft['kind'], string> = {
    decision: 'Conversation decision',
    policy_statement: 'Conversation policy statement',
    faq: 'Conversation FAQ',
    todo: 'Conversation TODO',
  };
  return {
    kind,
    title: `${titlePrefix[kind]}: ${segment.quote.slice(0, 48)}`,
    summary: segment.quote,
    bodyMarkdown: `# ${titlePrefix[kind]}\n\n> ${segment.quote}\n\nSpeaker: ${segment.speaker}`,
    speaker: segment.speaker,
    quote: segment.quote,
    riskFactors,
  };
}

export function extractConversationCandidates(
  transcript: string,
  options: ConversationExtractionOptions,
): CreateKnowledgeCandidate[] {
  return parseConversationTranscript(transcript)
    .map(classifySegment)
    .filter((draft): draft is ConversationCandidateDraft => Boolean(draft))
    .map((draft) => ({
      title: draft.title,
      summary: draft.summary,
      bodyMarkdown: draft.bodyMarkdown,
      status: 'NEEDS_CHECK',
      riskFactors: [...new Set([...draft.riskFactors, 'no_source' as const])],
      provenance: {
        kind: 'conversation',
        ref: options.sourceRef,
        ...(options.sourceLabel ? { label: options.sourceLabel } : {}),
        speaker: draft.speaker,
        conversationQuote: draft.quote,
        createdFromConversation: true,
        needsSource: true,
        metadata: { candidateKind: draft.kind },
      },
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    }));
}
