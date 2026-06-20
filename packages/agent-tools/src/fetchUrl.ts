import type { Policy } from '@wekiflow/wkf';

export interface FetchUrlState {
  fetchedUrls: Set<string>;
  rejectedUrls: Set<string>;
  fetchedCount: number;
}

export interface FetchUrlResult {
  url: string;
  status: 'fetched' | 'rejected';
  reason?: string;
  finalUrl?: string;
  contentType?: string;
  text?: string;
  fetchedCount: number;
}

export function createFetchUrlState(): FetchUrlState {
  return { fetchedUrls: new Set(), rejectedUrls: new Set(), fetchedCount: 0 };
}

function canonicalUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`Unsupported URL protocol: ${url.protocol}`);
  url.hash = '';
  return url;
}

function hostAllowed(host: string, allowedHosts: string[]): boolean {
  const normalized = host.toLowerCase();
  return allowedHosts.some((entry) => {
    const allowed = entry.toLowerCase();
    return normalized === allowed || normalized.endsWith(`.${allowed}`);
  });
}

function reject(state: FetchUrlState, url: string, reason: string): FetchUrlResult {
  state.rejectedUrls.add(url);
  return { url, status: 'rejected', reason, fetchedCount: state.fetchedCount };
}

export async function toolFetchUrl(
  rawUrl: string,
  policy: Policy,
  state: FetchUrlState,
  options: { fetchImpl?: typeof fetch; maxBytes?: number } = {},
): Promise<FetchUrlResult> {
  let url: URL;
  try {
    url = canonicalUrl(rawUrl);
  } catch (error) {
    return reject(state, rawUrl, error instanceof Error ? error.message : String(error));
  }

  const href = url.toString();
  if (state.rejectedUrls.has(href) || state.rejectedUrls.has(rawUrl)) return reject(state, href, 'URL was already rejected');
  if (!hostAllowed(url.hostname, policy.sources.allowed_hosts)) return reject(state, href, `Host not allowed: ${url.hostname}`);
  if (state.fetchedCount >= policy.enrichment.web_max_pages) {
    return reject(state, href, `web_max_pages exceeded: ${policy.enrichment.web_max_pages}`);
  }

  state.fetchedCount += 1;
  const response = await (options.fetchImpl ?? fetch)(href, { redirect: 'follow' });
  const finalUrl = response.url || href;
  let finalParsed: URL;
  try {
    finalParsed = canonicalUrl(finalUrl);
  } catch (error) {
    return reject(state, href, error instanceof Error ? error.message : String(error));
  }
  if (!hostAllowed(finalParsed.hostname, policy.sources.allowed_hosts)) {
    return reject(state, href, `Redirect host not allowed: ${finalParsed.hostname}`);
  }
  const contentType = response.headers.get('content-type') ?? undefined;
  if (!response.ok) return reject(state, href, `HTTP ${response.status}`);

  state.fetchedUrls.add(href);
  state.fetchedUrls.add(finalUrl);
  return {
    url: href,
    finalUrl,
    text: (await response.text()).slice(0, options.maxBytes ?? 250_000),
    status: 'fetched',
    fetchedCount: state.fetchedCount,
    ...(contentType ? { contentType } : {}),
  };
}
