import { createGoogleDriveConnector } from './adapters/googleDrive.js';
import { createMeetingConnector } from './adapters/meeting.js';
import { createSlackConnector } from './adapters/slack.js';
import { createUploadConnector } from './adapters/upload.js';
import { createUrlConnector } from './adapters/url.js';
import { ConnectorKindSchema, type ConnectorKind, type SourceConnector } from './types.js';

export function createConnectorRegistry(): Record<ConnectorKind, SourceConnector> {
  return {
    slack: createSlackConnector(),
    google_drive: createGoogleDriveConnector(),
    meeting: createMeetingConnector(),
    upload: createUploadConnector(),
    url: createUrlConnector(),
  };
}

const defaultRegistry = createConnectorRegistry();

export function getConnector(kind: ConnectorKind | string): SourceConnector {
  const parsed = ConnectorKindSchema.safeParse(kind);
  if (!parsed.success) throw new Error(`Unsupported connector kind: ${kind}`);
  return defaultRegistry[parsed.data];
}
