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
   * List image attachments of a page (GET only). Fetches all pages of
   * attachments (max 50 unique filenames referenced in content) until all
   * are resolved or no next page exists. Download URLs are NEVER guessed.
   * Response shape is validated per page.
   */
  async getAttachmentDownloadLinks(
    pageId: string,
    neededFilenames: Set<string>
  ): Promise<Map<string, { download: string; version: number }>> {
    const links = new Map<string, { download: string; version: number }>();
    if (neededFilenames.size === 0) return links;

    // The importer processes at most 50 image refs per page; clamp the
    // lookup set to the same bound so a hostile page cannot force extra
    // metadata paging work.
    let needed = neededFilenames;
    if (needed.size > 50) {
      needed = new Set(Array.from(neededFilenames).slice(0, 50));
    }

    const limit = 100;
    let start = 0;
    let hasMore = true;
    let pagesFetched = 0;
    const MAX_PAGES = 10; // Safety cap: 10 pages × 100 = 1000 attachments max

    while (hasMore && pagesFetched < MAX_PAGES && links.size < needed.size) {
      const url = `${this.baseUrl}/rest/api/content/${encodeURIComponent(pageId)}/child/attachment?limit=${limit}&start=${start}`;
      const response = await this.request(url, { method: 'GET' });
      pagesFetched++;

      const res = response as Record<string, unknown>;
      if (response == null || typeof response !== 'object' || !Array.isArray(res.results)) {
        throw new ConfluenceApiError(
          0,
          'Invalid response',
          'The Confluence attachment API returned an unexpected response shape (missing results array).'
        );
      }

      for (const entry of res.results) {
        if (entry == null || typeof entry !== 'object') continue;
        const e = entry as Record<string, unknown>;
        const linksObj = e._links as Record<string, unknown> | undefined;
        const title = e.title;
        const download = linksObj?.download;
        const version = (e.version as Record<string, unknown> | undefined)?.number;

        if (
          typeof title === 'string' && title.length > 0 &&
          typeof download === 'string' && download.length > 0 &&
          typeof version === 'number' && version > 0
        ) {
          // Duplicate titles can appear (multiple versions listed);
          // always keep the highest positive version number.
          if (needed.has(title)) {
            const existing = links.get(title);
            if (!existing || version > existing.version) {
              links.set(title, { download, version });
            }
          }
        }
      }

      // Reject non-advancing pagination: a page with zero results that
      // still claims a `next` link would loop forever on a broken/hostile
      // server. Our `start` offset is client-controlled so it always
      // advances, but there is no point continuing past an empty page.
      if (res.results.length === 0) {
        break;
      }

      const linksObj = res._links as Record<string, unknown> | undefined;
      hasMore = typeof linksObj?.next === 'string';
      start += limit;
    }

    return links;
  }

  /**
   * Download a binary attachment (GET only) from an ALREADY-VALIDATED
   * same-origin URL. Returns the raw bytes plus the declared content type.
   * Callers are responsible for origin validation BEFORE calling this —
   * this method additionally re-asserts the origin as defense in depth.
   */
  async downloadBinary(absoluteUrl: string): Promise<{ data: ArrayBuffer; contentType: string }> {
    const target = new URL(absoluteUrl);
    const base = new URL(this.baseUrl);
    if (target.origin !== base.origin) {
      throw new ConfluenceApiError(
        0,
        'Blocked download',
        'Attachment download URL does not match the configured Confluence origin.'
      );
    }

    const response = await requestUrl({
      url: absoluteUrl,
      method: 'GET',
      headers: { 'Authorization': this.authHeader },
      throw: false,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new ConfluenceApiError(
        response.status,
        response.status === 429 ? 'Rate limit exceeded' : 'Attachment download failed',
        `HTTP ${response.status}`
      );
    }

    const contentTypeHeader = response.headers['content-type'] ?? response.headers['Content-Type'] ?? '';
    return {
      data: response.arrayBuffer,
      contentType: typeof contentTypeHeader === 'string' ? contentTypeHeader : '',
    };
  }

  /** The configured base URL (read-only accessor for URL resolution). */
  getBaseUrl(): string {
    return this.baseUrl;
  }

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
