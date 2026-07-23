import { requestUrl, RequestUrlParam } from 'obsidian';
import { PageContent } from '../models';

export interface ConfluenceApiConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

/** A Confluence page version must be a finite positive integer. */
function isValidVersionNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v > 0;
}

/**
 * Encode a string to Base64 in a Unicode-safe way.
 * `btoa` only handles Latin-1 (code points 0–255). When the email or API
 * token contains multi-byte characters (e.g. Chinese, emoji) it throws
 * "The string to be encoded contains characters outside of the Latin1 range".
 * We use TextEncoder to get UTF-8 bytes, then convert them to a binary string
 * that btoa can handle. This avoids the deprecated `unescape` function.
 */
function toBase64(str: string): string {
  try {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  } catch {
    // TextEncoder/btoa should never fail for valid JS strings in modern
    // environments, but guard against any future engine quirk.
    throw new Error(
      'Confluence credentials contain characters that cannot be encoded. ' +
      'Please verify your email and API token in Settings.'
    );
  }
}

export class ConfluenceApiClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(config: ConfluenceApiConfig) {
    this.baseUrl = config.baseUrl;

    // Heuristic: If URL contains atlassian.net, assume Cloud (Basic Auth)
    // Otherwise assume Server/Data Center (Bearer Auth)
    if (this.baseUrl.includes('atlassian.net')) {
      const credentials = `${config.email}:${config.apiToken}`;
      this.authHeader = `Basic ${toBase64(credentials)}`;
    } else {
      // Use Bearer token for on-prem/PAT
      this.authHeader = `Bearer ${config.apiToken}`;
    }
  }

  /**
   * Get page content by ID.
   * Validates the response shape before returning so callers can safely
   * access `body.storage.value` without defensive checks at every call site.
   */
  async getPage(pageId: string): Promise<PageContent> {
    const url = `${this.baseUrl}/rest/api/content/${pageId}?expand=body.storage,version,space`;

    const response = await this.request(url, {
      method: 'GET'
    });

    this.assertPageShape(response);
    return response;
  }

  /**
   * Throws a descriptive error if the API response does not look like a
   * valid PageContent object. Guards against truncated responses, unexpected
   * API changes, or non-JSON bodies that requestUrl silently returns as null.
   */
  private assertPageShape(data: unknown): asserts data is PageContent {
    const d = data as Record<string, unknown>;
    const body = d?.body as Record<string, unknown> | undefined;
    const storage = body?.storage as Record<string, unknown> | undefined;
    const version = d?.version as Record<string, unknown> | undefined;

    if (
      data == null ||
      typeof data !== 'object' ||
      typeof d.id !== 'string' ||
      typeof d.title !== 'string' ||
      typeof storage?.value !== 'string' ||
      !isValidVersionNumber(version?.number)
    ) {
      throw new ConfluenceApiError(
        0,
        'Invalid response',
        'The Confluence API returned an unexpected response shape. ' +
        'Expected a page object with id, title, body.storage.value, and a positive integer version.number.'
      );
    }
  }

  /**
   * Validate the shape of a search result entry for the fields we actually
   * consume (id, title, version.number, space.key). Body is not required
   * because search callers use expand without body.
   */
  private assertSearchResultShape(entry: unknown): void {
    const e = entry as Record<string, unknown>;
    const version = e?.version as Record<string, unknown> | undefined;
    const space = e?.space as Record<string, unknown> | undefined;

    if (
      entry == null ||
      typeof entry !== 'object' ||
      typeof e.id !== 'string' ||
      typeof e.title !== 'string' ||
      !isValidVersionNumber(version?.number) ||
      typeof space?.key !== 'string'
    ) {
      throw new ConfluenceApiError(
        0,
        'Invalid response',
        'The Confluence search API returned a result entry with an unexpected shape. ' +
        'Expected id, title, version.number (positive integer), and space.key.'
      );
    }
  }

  /**
   * Search for pages by title in a space
   */
  async searchContent(params: {
    spaceKey: string;
    title: string;
    expand?: string;
  }): Promise<{ results: PageContent[]; size: number }> {

    const queryParams = new URLSearchParams({
      spaceKey: params.spaceKey,
      title: params.title,
      type: 'page',
      expand: params.expand || 'body.storage,version,space'
    });

    const url = `${this.baseUrl}/rest/api/content?${queryParams}`;

    const response = await this.request(url, {
      method: 'GET'
    });

    // SECURITY/robustness: validate shape before callers touch fields.
    // Raw response bodies are never included in the error.
    const res = response as Record<string, unknown>;
    if (response == null || typeof response !== 'object' || !Array.isArray(res.results)) {
      throw new ConfluenceApiError(
        0,
        'Invalid response',
        'The Confluence search API returned an unexpected response shape (missing results array).'
      );
    }
    for (const entry of res.results) {
      this.assertSearchResultShape(entry);
    }
    return response as { results: PageContent[]; size: number };
  }

  // NOTE: This client is intentionally READ-ONLY. The plugin's sync is
  // strictly one-way (Confluence → Obsidian); the page-update and
  // attachment-upload methods were removed on purpose. Do not re-add
  // write endpoints without revisiting the pull-only contract and its tests.

  /**
   * Test connection
   */
  async testConnection(): Promise<boolean> {
    try {
      // Changed to use content listing as a safer generic check than user/current
      const url = `${this.baseUrl}/rest/api/content?limit=1`;
      await this.request(url, { method: 'GET' });
      return true;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('Connection test failed', message);
      return false;
    }
  }

  /**
   * Make authenticated request using Obsidian requestUrl.
   *
   * Takes a narrow, fully typed option shape (method/headers/body only)
   * so no unsafe casts are needed when building `RequestUrlParam`.
   */
  private async request(
    url: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: string | ArrayBuffer;
    }
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      'Authorization': this.authHeader,
      'Accept': 'application/json',
    };

    if (options.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        if (typeof value === 'string') {
          headers[key] = value;
        }
      }
    }

    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    // Transform options for requestUrl
    const reqOptions: RequestUrlParam = {
      url: url,
      method: options.method ?? 'GET',
      headers: headers,
      body: options.body,
      throw: false // We check status manually
    };

    const response = await requestUrl(reqOptions);

    if (response.status < 200 || response.status >= 300) {
      // Confluence might return HTML error pages or JSON
      const errorBody = response.text;
      const statusText =
        response.status === 429 ? 'Rate limit exceeded' : 'API Error';
      throw new ConfluenceApiError(
        response.status,
        statusText,
        errorBody
      );
    }

    return response.json as unknown;
  }
}

export class ConfluenceApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: string
  ) {
    super(`Confluence API Error (${status}): ${statusText}`);
    this.name = 'ConfluenceApiError';
  }
}
