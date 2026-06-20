import { describe, expect, it } from 'vitest';
import { canAutoPublish } from '@wf/shared';
import { extractConversationCandidates, parseConversationTranscript } from './conversation.js';

describe('conversation extraction', () => {
  it('parses speaker-prefixed transcript lines', () => {
    expect(parseConversationTranscript('A: Decide policy\nloose note')).toEqual([
      { speaker: 'A', quote: 'Decide policy' },
      { speaker: 'Unknown', quote: 'loose note' },
    ]);
  });

  it('creates needs-check candidates with conversation provenance', () => {
    const candidates = extractConversationCandidates(
      [
        'Jin: Decision: pricing answers require approval.',
        'Mina: What is the password reset process?',
        'Alex: TODO connect the source handbook.',
      ].join('\n'),
      { sourceRef: 'slack://thread/1', sourceLabel: 'Slack thread', workspaceId: 'workspace-1' },
    );

    expect(candidates).toHaveLength(3);
    expect(candidates[0]).toMatchObject({
      status: 'NEEDS_CHECK',
      riskFactors: expect.arrayContaining(['pricing', 'no_source']),
      provenance: {
        kind: 'conversation',
        ref: 'slack://thread/1',
        speaker: 'Jin',
        createdFromConversation: true,
        needsSource: true,
      },
      workspaceId: 'workspace-1',
    });
    expect(
      canAutoPublish({
        status: 'NEEDS_CHECK',
        riskFactors: candidates[0]!.riskFactors ?? [],
        provenance: candidates[0]!.provenance,
      }),
    ).toBe(false);
  });
});
