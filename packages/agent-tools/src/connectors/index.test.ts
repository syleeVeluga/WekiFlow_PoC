import { describe, expect, it } from 'vitest';
import { ConnectorNotConfiguredError, createConnector, createDefaultConnectors } from './index.js';

describe('connectors', () => {
  it('implements the Source contract for existing local source kinds', async () => {
    const source = createConnector('manual', [
      { ref: { kind: 'manual', ref: 'manual://leave', title: 'Leave' }, text: '# Leave\nPolicy body' },
    ]);

    await expect(source.list()).resolves.toEqual([{ kind: 'manual', ref: 'manual://leave', title: 'Leave' }]);
    await expect(source.fetch({ kind: 'manual', ref: 'manual://leave' })).resolves.toMatchObject({
      text: '# Leave\nPolicy body',
    });
  });

  it('provides confluence, gdrive, and github as explicit stubs', async () => {
    const connectors = createDefaultConnectors();

    expect(Object.keys(connectors).sort()).toEqual(['confluence', 'datasource', 'gdrive', 'github', 'manual', 'upload']);
    await expect(connectors.github.fetch({ kind: 'github', ref: 'repo://owner/name' })).rejects.toBeInstanceOf(
      ConnectorNotConfiguredError,
    );
  });
});
