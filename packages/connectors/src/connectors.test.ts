import { describe, expect, it } from 'vitest';
import {
  ConnectorConfigSchema,
  connectorKinds,
  createConnectorRegistry,
  createSlackConnector,
  getConnector,
  parseTranscriptSegments,
} from './index.js';

describe('@wf/connectors', () => {
  it('registers every connector kind', () => {
    const registry = createConnectorRegistry();

    expect(Object.keys(registry).sort()).toEqual([...connectorKinds].sort());
    expect(getConnector('slack').kind).toBe('slack');
    expect(() => getConnector('unknown')).toThrow('Unsupported connector kind');
  });

  it('returns mock list/fetch results for file and URL style connectors', async () => {
    const drive = getConnector('google_drive');
    const upload = getConnector('upload');
    const url = getConnector('url');

    await expect(drive.list()).resolves.toEqual([
      expect.objectContaining({ kind: 'google_drive', ref: expect.stringMatching(/^gdrive:\/\//) }),
    ]);
    await expect(drive.fetch((await drive.list())[0]!.ref)).resolves.toMatchObject({
      provenance: { kind: 'datasource', needsSource: false },
    });
    await expect(upload.fetch('upload://samples/handbook.md')).resolves.toMatchObject({ provenance: { kind: 'file' } });
    await expect(url.fetch('https://example.com/wekiflow/source-policy')).resolves.toMatchObject({ provenance: { kind: 'url' } });
  });

  it('maps Slack and meeting mocks to conversation provenance', async () => {
    const slack = createSlackConnector();
    const meeting = getConnector('meeting');

    await expect(slack.listChannels()).resolves.toEqual([{ id: 'C-KNOWLEDGE', name: 'knowledge' }]);
    await expect(slack.listMessages('C-KNOWLEDGE')).resolves.toEqual([
      expect.objectContaining({ metadata: expect.objectContaining({ channelId: 'C-KNOWLEDGE' }) }),
    ]);
    await expect(slack.fetch((await slack.list())[0]!)).resolves.toMatchObject({
      provenance: {
        kind: 'conversation',
        createdFromConversation: true,
        needsSource: true,
      },
    });
    await expect(meeting.fetch((await meeting.list())[0]!)).resolves.toMatchObject({
      metadata: { transcript: expect.any(Array) },
      provenance: {
        kind: 'conversation',
        speaker: expect.any(String),
      },
    });
    expect(parseTranscriptSegments('A: first\nB: second')).toEqual([
      { speaker: 'A', quote: 'first', offsetSeconds: 0 },
      { speaker: 'B', quote: 'second', offsetSeconds: 30 },
    ]);
  });

  it('parses empty credential placeholders', () => {
    expect(ConnectorConfigSchema.parse({})).toMatchObject({
      slack: { botToken: '', signingSecret: '' },
      googleDrive: { clientId: '', clientSecret: '', refreshToken: '' },
      meeting: { transcriptBucket: '' },
      url: { allowlist: [] },
    });
  });
});
