export type ConnectorKind = 'upload' | 'datasource' | 'manual' | 'confluence' | 'gdrive' | 'github';

export interface SourceRef {
  kind: ConnectorKind;
  ref: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface SourceDocument {
  ref: SourceRef;
  text: string;
}

export interface Source {
  readonly kind: ConnectorKind;
  list(): Promise<SourceRef[]>;
  fetch(ref: SourceRef): Promise<SourceDocument>;
}

export class ConnectorNotConfiguredError extends Error {
  constructor(kind: ConnectorKind) {
    super(`${kind} connector is not configured`);
    this.name = 'ConnectorNotConfiguredError';
  }
}

export class StaticSource implements Source {
  constructor(
    public readonly kind: ConnectorKind,
    private readonly documents: SourceDocument[],
  ) {}

  async list(): Promise<SourceRef[]> {
    return this.documents.map((document) => document.ref);
  }

  async fetch(ref: SourceRef): Promise<SourceDocument> {
    const found = this.documents.find((document) => document.ref.kind === ref.kind && document.ref.ref === ref.ref);
    if (!found) throw new Error(`Source ref not found: ${ref.kind}:${ref.ref}`);
    return found;
  }
}

export class StubSource implements Source {
  constructor(public readonly kind: ConnectorKind) {}

  async list(): Promise<SourceRef[]> {
    return [];
  }

  async fetch(): Promise<SourceDocument> {
    throw new ConnectorNotConfiguredError(this.kind);
  }
}

export function createConnector(kind: ConnectorKind, documents: SourceDocument[] = []): Source {
  if (kind === 'upload' || kind === 'datasource' || kind === 'manual') return new StaticSource(kind, documents);
  return new StubSource(kind);
}

export function createDefaultConnectors(): Record<ConnectorKind, Source> {
  return {
    upload: createConnector('upload'),
    datasource: createConnector('datasource'),
    manual: createConnector('manual'),
    confluence: createConnector('confluence'),
    gdrive: createConnector('gdrive'),
    github: createConnector('github'),
  };
}
