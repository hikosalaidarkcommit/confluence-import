// @ts-ignore
import { requestUrl, RequestUrlParam } from 'obsidian';
import { PageContent } from '../models';

export interface ConfluenceApiConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
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
      // Base64 encode for Basic Auth
      this.authHeader = `Basic ${btoa(credentials)}`;
    } else {
      // Use Bearer token for on-prem/PAT
      this.authHeader = `Bearer ${config.apiToken}`;
    }
  }

  /**
   * Get page content by ID
   */
  async getPage(pageId: string): Promise<PageContent> {
    const url = `${this.baseUrl}/rest/api/content/${pageId}?expand=body.storage,version,space`;

    const response = await this.request(url, {
      method: 'GET'
    });

    return response;
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

    return await this.request(url, {
      method: 'GET'
    });
  }

  /**
   * Update page content
   */
  async updatePage(
    pageId: string,
    title: string,
    content: string,
    version: number
  ): Promise<PageContent> {

    const url = `${this.baseUrl}/rest/api/content/${pageId}`;

    const payload = {
      version: {
        number: version + 1
      },
      title: title,
      type: 'page',
      body: {
        storage: {
          value: content,
          representation: 'storage'
        }
      }
    };

    return await this.request(url, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  }

  /**
   * Upload attachment to page
   */
  async uploadAttachment(
    pageId: string,
    fileData: ArrayBuffer,
    filename: string
  ): Promise<{ filename: string; id: string }> {

    const url = `${this.baseUrl}/rest/api/content/${pageId}/child/attachment`;

    // Obsidian requestUrl doesn't support FormData directly nicely for multipart.
    // However, we can construct the body manually.

    const boundary = '----ObsidianConfluenceSyncBoundary' + Math.random().toString(36).substring(2);
    const body = await this.createMultipartBody(fileData, filename, boundary);

    const response = await this.request(url, {
      method: 'POST',
      body: body,
      headers: {
        'X-Atlassian-Token': 'no-check',
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      }
    }, true
    );

    if (response.results && response.results.length > 0) {
      return {
        filename: response.results[0].title,
        id: response.results[0].id
      };
    }
    throw new Error('Upload failed, no results returned');
  }

  private async createMultipartBody(fileData: ArrayBuffer, filename: string, boundary: string): Promise<ArrayBuffer> {
    // Helper to build multipart body
    const crlf = '\r\n';
    const type = 'application/octet-stream'; // Default

    const encoder = new TextEncoder();

    // We must handle the binary data concatenation correctly.
    // Note: requestUrl body expectation: "string | ArrayBuffer"

    const header = `--${boundary}${crlf}Content-Disposition: form-data; name="file"; filename="${filename}"${crlf}Content-Type: ${type}${crlf}${crlf}`;
    const footer = `${crlf}--${boundary}${crlf}Content-Disposition: form-data; name="minorEdit"${crlf}${crlf}true${crlf}--${boundary}--${crlf}`;

    const headerBytes = encoder.encode(header);
    const footerBytes = encoder.encode(footer);
    const fileBytes = new Uint8Array(fileData);

    const combined = new Uint8Array(headerBytes.length + fileBytes.length + footerBytes.length);
    combined.set(headerBytes);
    combined.set(fileBytes, headerBytes.length);
    combined.set(footerBytes, headerBytes.length + fileBytes.length);

    return combined.buffer;
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
    } catch (e) {
      console.error('Connection test failed', e);
      return false;
    }
  }

  /**
   * Make authenticated request using Obsidian requestUrl
   */
  private async request(url: string, options: RequestInit, skipContentType = false): Promise<any> {
    const headers: Record<string, string> = {
      'Authorization': this.authHeader,
      'Accept': 'application/json',
      ...(options.headers as Record<string, string> || {})
    };

    if (!skipContentType && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    // Transform options for requestUrl
    const reqOptions: RequestUrlParam = {
      url: url,
      method: options.method || 'GET',
      headers: headers,
      body: options.body as string | ArrayBuffer,
      throw: false // We check status manually
    };

    const response = await requestUrl(reqOptions);

    if (response.status < 200 || response.status >= 300) {
      // Confluence might return HTML error pages or JSON
      const errorBody = response.text;
      console.error('API Error', response.status, errorBody);
      throw new ConfluenceApiError(
        response.status,
        'API Error',
        errorBody
      );
    }

    return response.json;
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
