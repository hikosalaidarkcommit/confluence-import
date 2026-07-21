/**
 * Unit tests for ConfluenceApiClient — Unicode auth encoding, response-shape
 * validation, and HTTP status handling.
 *
 * This file does NOT mock '../../src/api/confluence-client' so it exercises
 * the real class. The 'obsidian' module is still mapped to the hand-written
 * mock by Jest moduleNameMapper (provides requestUrl as a jest.fn()).
 */
import { ConfluenceApiClient, ConfluenceApiError } from '../../src/api/confluence-client';

const VALID_PAGE = {
    id: '123',
    title: 'My Page',
    type: 'page',
    status: 'current',
    body: { storage: { value: '<p>hello</p>', representation: 'storage' } },
    version: { number: 3, when: '2026-01-01' },
    space: { key: 'SP', name: 'Space' },
};

describe('ConfluenceApiClient', () => {
    // requestUrl is a jest.fn() provided by tests/mocks/obsidian.ts
    const { requestUrl } = require('obsidian');

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Unicode credential encoding (Cloud Basic Auth)
    // ─────────────────────────────────────────────────────────────────────────
    describe('Unicode credential encoding (Cloud Basic Auth)', () => {
        /**
         * Decode a "Basic <b64>" header value back to the original credential
         * string using the same Unicode-aware technique as the production code
         * (but in reverse: atob → Latin-1 bytes → percent-decode → UTF-8).
         */
        function decodeBasicHeader(header: string): string {
            const b64 = header.replace(/^Basic /, '');
            return decodeURIComponent(escape(atob(b64)));
        }

        test('ASCII credentials: encoded correctly and round-trips', () => {
            const client = new ConfluenceApiClient({
                baseUrl: 'https://example.atlassian.net',
                email: 'user@example.com',
                apiToken: 'token123',
            });
            const header = (client as any).authHeader as string;
            expect(header).toMatch(/^Basic /);
            expect(decodeBasicHeader(header)).toBe('user@example.com:token123');
        });

        test('Unicode email: does not throw and round-trips correctly', () => {
            expect(() => new ConfluenceApiClient({
                baseUrl: 'https://example.atlassian.net',
                email: '用戶@example.com',
                apiToken: 'token123',
            })).not.toThrow();

            const client = new ConfluenceApiClient({
                baseUrl: 'https://example.atlassian.net',
                email: '用戶@example.com',
                apiToken: 'token123',
            });
            const header = (client as any).authHeader as string;
            expect(header).toMatch(/^Basic /);
            expect(decodeBasicHeader(header)).toBe('用戶@example.com:token123');
        });

        test('Unicode API token: does not throw and round-trips correctly', () => {
            expect(() => new ConfluenceApiClient({
                baseUrl: 'https://example.atlassian.net',
                email: 'user@example.com',
                apiToken: '日本語トークン🔑',
            })).not.toThrow();

            const client = new ConfluenceApiClient({
                baseUrl: 'https://example.atlassian.net',
                email: 'user@example.com',
                apiToken: '日本語トークン🔑',
            });
            expect(decodeBasicHeader((client as any).authHeader)).toBe(
                'user@example.com:日本語トークン🔑'
            );
        });

        test('Server/Data Center (non-atlassian.net): uses Bearer token, not Basic', () => {
            const client = new ConfluenceApiClient({
                baseUrl: 'https://confluence.mycompany.com',
                email: 'user@example.com',
                apiToken: 'pat-token',
            });
            expect((client as any).authHeader).toBe('Bearer pat-token');
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // assertPageShape — invalid response validation
    // ─────────────────────────────────────────────────────────────────────────
    describe('assertPageShape — invalid response validation', () => {
        function makeClient() {
            return new ConfluenceApiClient({
                baseUrl: 'https://example.atlassian.net',
                email: 'u@e.com',
                apiToken: 'tok',
            });
        }

        async function getPageWith(responseBody: any) {
            const client = makeClient();
            requestUrl.mockResolvedValueOnce({
                status: 200,
                json: responseBody,
                text: '',
            });
            return client.getPage('123');
        }

        test('valid shape: resolves to the page object', async () => {
            const page = await getPageWith(VALID_PAGE);
            expect(page.id).toBe('123');
            expect(page.body.storage.value).toBe('<p>hello</p>');
            expect(page.version.number).toBe(3);
        });

        test('null response: throws ConfluenceApiError with status 0', async () => {
            await expect(getPageWith(null)).rejects.toThrow(ConfluenceApiError);
            // Second call needs another mock resolve
            requestUrl.mockResolvedValueOnce({ status: 200, json: null, text: '' });
            await expect(makeClient().getPage('123')).rejects.toMatchObject({ status: 0 });
        });

        test('missing body.storage.value: throws ConfluenceApiError', async () => {
            await expect(getPageWith({
                id: '123',
                title: 'T',
                body: {},
                version: { number: 1, when: '' },
            })).rejects.toThrow(ConfluenceApiError);
        });

        test('version.number is string instead of number: throws ConfluenceApiError', async () => {
            await expect(getPageWith({
                id: '123',
                title: 'T',
                body: { storage: { value: 'v', representation: 'storage' } },
                version: { number: '5', when: '' }, // string, not number
            })).rejects.toThrow(ConfluenceApiError);
        });

        test('missing title: throws ConfluenceApiError', async () => {
            await expect(getPageWith({
                id: '123',
                body: { storage: { value: 'v', representation: 'storage' } },
                version: { number: 1, when: '' },
            })).rejects.toThrow(ConfluenceApiError);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // HTTP status error handling
    // ─────────────────────────────────────────────────────────────────────────
    describe('HTTP error status codes', () => {
        function makeClient() {
            return new ConfluenceApiClient({
                baseUrl: 'https://example.atlassian.net',
                email: 'u@e.com',
                apiToken: 'tok',
            });
        }

        async function getPageWithStatus(status: number) {
            const client = makeClient();
            requestUrl.mockResolvedValueOnce({ status, json: null, text: 'error' });
            return client.getPage('123');
        }

        test('401 response: throws ConfluenceApiError with status 401', async () => {
            await expect(getPageWithStatus(401)).rejects.toMatchObject({ status: 401 });
        });

        test('403 response: throws ConfluenceApiError with status 403', async () => {
            await expect(getPageWithStatus(403)).rejects.toMatchObject({ status: 403 });
        });

        test('404 response: throws ConfluenceApiError with status 404', async () => {
            await expect(getPageWithStatus(404)).rejects.toMatchObject({ status: 404 });
        });

        test('429 response: throws ConfluenceApiError with statusText "Rate limit exceeded"', async () => {
            await expect(getPageWithStatus(429)).rejects.toMatchObject({
                status: 429,
                statusText: 'Rate limit exceeded',
            });
        });

        test('500 response: throws ConfluenceApiError with status 500', async () => {
            await expect(getPageWithStatus(500)).rejects.toMatchObject({ status: 500 });
        });
    });
});
