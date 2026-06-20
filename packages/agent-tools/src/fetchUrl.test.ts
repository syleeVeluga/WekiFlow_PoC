import { describe, expect, it } from 'vitest';
import { defaultPolicy, type Policy } from '@wekiflow/wkf';
import { createFetchUrlState, toolFetchUrl } from './fetchUrl.js';

const policy = (override: Partial<Policy> = {}): Policy => ({
  ...defaultPolicy,
  ...override,
  sources: { ...defaultPolicy.sources, allowed_hosts: ['example.com'], ...(override.sources ?? {}) },
  enrichment: { ...defaultPolicy.enrichment, web_max_pages: 1, ...(override.enrichment ?? {}) },
});

describe('toolFetchUrl', () => {
  it('rejects hosts outside policy.sources.allowed_hosts without fetching', async () => {
    const state = createFetchUrlState();
    let calls = 0;
    const result = await toolFetchUrl('https://evil.test/page', policy(), state, {
      fetchImpl: (async () => {
        calls += 1;
        throw new Error('should not fetch');
      }) as typeof fetch,
    });

    expect(result).toMatchObject({ status: 'rejected', reason: 'Host not allowed: evil.test' });
    expect(calls).toBe(0);
  });

  it('enforces web_max_pages before making another request', async () => {
    const state = createFetchUrlState();
    let calls = 0;
    const fetchImpl = (async (url: string) => {
      calls += 1;
      return new Response(`body:${url}`, { status: 200, headers: { 'content-type': 'text/plain' } });
    }) as typeof fetch;

    await expect(toolFetchUrl('https://example.com/a', policy(), state, { fetchImpl })).resolves.toMatchObject({
      status: 'fetched',
      fetchedCount: 1,
    });
    await expect(toolFetchUrl('https://example.com/b', policy(), state, { fetchImpl })).resolves.toMatchObject({
      status: 'rejected',
      reason: 'web_max_pages exceeded: 1',
      fetchedCount: 1,
    });
    expect(calls).toBe(1);
  });

  it('does not retry URLs that were already rejected', async () => {
    const state = createFetchUrlState();
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response('nope', { status: 500 });
    }) as typeof fetch;

    await expect(toolFetchUrl('https://example.com/fail', policy(), state, { fetchImpl })).resolves.toMatchObject({
      status: 'rejected',
      reason: 'HTTP 500',
    });
    await expect(toolFetchUrl('https://example.com/fail', policy(), state, { fetchImpl })).resolves.toMatchObject({
      status: 'rejected',
      reason: 'URL was already rejected',
    });
    expect(calls).toBe(1);
  });

  it('rejects redirects to hosts outside the allowlist', async () => {
    const state = createFetchUrlState();
    const result = await toolFetchUrl('https://example.com/redirect', policy({ enrichment: { ...defaultPolicy.enrichment, web_max_pages: 2 } }), state, {
      fetchImpl: (async () => {
        const response = new Response('redirected', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        });
        Object.defineProperty(response, 'url', { value: 'https://evil.test/redirected' });
        return response;
      }) as typeof fetch,
    });
    expect(result).toMatchObject({ status: 'rejected', reason: 'Redirect host not allowed: evil.test' });
  });
});
