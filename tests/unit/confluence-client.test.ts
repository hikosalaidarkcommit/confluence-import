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
        jest.resetAllMocks();
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
            const binary = atob(b64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return new TextDecoder().decode(bytes);
        }

        test('ASCII credentials: encoded correctly and round-trips', () => {
            const client = new ConfluenceApiClient({
                baseUrl: 'https://example.atlassian.net',
                email: 'user@example.com',
                apiToken: 'token123',
            });
            const header = (client as unknown as { authHeader: string }).authHeader;
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
            const header = (client as unknown as { authHeader: string }).authHeader;
            expect(header).toMatch(/^Basic /);
            // Verify round-trip decoding
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
            expect(decodeBasicHeader((client as unknown as { authHeader: string }).authHeader)).toBe(
                'user@example.com:日本語トークン🔑'
            );
        });

        test('Server/Data Center (non-atlassian.net): uses Bearer token, not Basic', () => {
            const client = new ConfluenceApiClient({
                baseUrl: 'https://confluence.mycompany.com',
                email: 'user@example.com',
                apiToken: 'pat-token',
            });
            expect((client as unknown as { authHeader: string }).authHeader).toBe('Bearer pat-token');
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

        async function getPageWith(responseBody: unknown) {
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
    // getAttachmentDownloadLinks — pagination and metadata
    // ─────────────────────────────────────────────────────────────────────────
    describe('getAttachmentDownloadLinks — pagination and metadata', () => {
        function makeClient() {
            return new ConfluenceApiClient({
                baseUrl: 'https://example.atlassian.net',
                email: 'u@e.com',
                apiToken: 'tok',
            });
        }

        test('paginates until all needed filenames are resolved', async () => {
            const client = makeClient();
            const needed = new Set(['img1.png', 'img2.png']);

            // Page 1: contains img1.png, has a next link
            requestUrl.mockResolvedValueOnce({
                status: 200,
                json: {
                    results: [
                        { title: 'img1.png', version: { number: 1 }, _links: { download: '/dl/img1' } },
                        { title: 'other.png', version: { number: 1 }, _links: { download: '/dl/other' } },
                    ],
                    _links: { next: '/next-page' }
                },
                text: ''
            });

            // Page 2: contains img2.png
            requestUrl.mockResolvedValueOnce({
                status: 200,
                json: {
                    results: [
                        { title: 'img2.png', version: { number: 2 }, _links: { download: '/dl/img2' } },
                    ],
                    _links: {}
                },
                text: ''
            });

            const links = await client.getAttachmentDownloadLinks('123', needed);
            expect(links.size).toBe(2);
            expect(links.get('img1.png')).toEqual({ download: '/dl/img1', version: 1 });
            expect(links.get('img2.png')).toEqual({ download: '/dl/img2', version: 2 });
            expect(requestUrl).toHaveBeenCalledTimes(2);
        });

        test('stops early if all needed resolved even if more pages exist', async () => {
            const client = makeClient();
            const needed = new Set(['img1.png']);

            requestUrl.mockResolvedValueOnce({
                status: 200,
                json: {
                    results: [{ title: 'img1.png', version: { number: 1 }, _links: { download: '/dl/1' } }],
                    _links: { next: '/more' }
                },
                text: ''
            });

            const links = await client.getAttachmentDownloadLinks('123', needed);
            expect(links.size).toBe(1);
            expect(requestUrl).toHaveBeenCalledTimes(1); // No second fetch
        });

        test('handles duplicates by choosing highest version', async () => {
            const client = makeClient();
            const needed = new Set(['img.png']);

            requestUrl.mockResolvedValueOnce({
                status: 200,
                json: {
                    results: [
                        { title: 'img.png', version: { number: 1 }, _links: { download: '/dl/v1' } },
                        { title: 'img.png', version: { number: 3 }, _links: { download: '/dl/v3' } },
                        { title: 'img.png', version: { number: 2 }, _links: { download: '/dl/v2' } },
                    ],
                    _links: {}
                },
                text: ''
            });

            const links = await client.getAttachmentDownloadLinks('123', needed);
            expect(links.get('img.png')?.version).toBe(3);
            expect(links.get('img.png')?.download).toBe('/dl/v3');
        });

        test('enforces MAX_PAGES safety cap (10 pages / 1000 results)', async () => {
            const client = makeClient();
            const needed = new Set(['missing.png']);

            // Mock 11 NON-EMPTY pages that never contain the needed file and
            // always claim a next page — the client must stop at 10.
            for (let i = 0; i < 11; i++) {
                requestUrl.mockResolvedValueOnce({
                    status: 200,
                    json: {
                        results: [
                            { title: `filler-${i}.png`, version: { number: 1 }, _links: { download: `/dl/f${i}` } },
                        ],
                        _links: { next: '/more' }
                    },
                    text: ''
                });
            }

            await client.getAttachmentDownloadLinks('123', needed);
            expect(requestUrl).toHaveBeenCalledTimes(10); // Cap at 10
        });

        test('rejects non-advancing pagination: empty results page with next link stops immediately', async () => {
            const client = makeClient();
            const needed = new Set(['missing.png']);

            requestUrl.mockResolvedValue({
                status: 200,
                json: { results: [], _links: { next: '/more' } },
                text: ''
            });

            const links = await client.getAttachmentDownloadLinks('123', needed);
            expect(links.size).toBe(0);
            expect(requestUrl).toHaveBeenCalledTimes(1); // No infinite loop
        });

        test('finds a filename located after index 200 (page 3)', async () => {
            const client = makeClient();
            const needed = new Set(['deep.png']);

            // Pages 1 and 2: 100 fillers each; page 3 holds the needed file.
            for (let p = 0; p < 2; p++) {
                requestUrl.mockResolvedValueOnce({
                    status: 200,
                    json: {
                        results: Array.from({ length: 100 }, (_, i) => ({
                            title: `filler-${p}-${i}.png`,
                            version: { number: 1 },
                            _links: { download: `/dl/${p}-${i}` },
                        })),
                        _links: { next: '/more' }
                    },
                    text: ''
                });
            }
            requestUrl.mockResolvedValueOnce({
                status: 200,
                json: {
                    results: [{ title: 'deep.png', version: { number: 7 }, _links: { download: '/dl/deep' } }],
                    _links: {}
                },
                text: ''
            });

            const links = await client.getAttachmentDownloadLinks('123', needed);
            expect(links.get('deep.png')).toEqual({ download: '/dl/deep', version: 7 });
            expect(requestUrl).toHaveBeenCalledTimes(3);
            // Verify the client advanced the start offset across pages.
            const calls = requestUrl.mock.calls.map((c: unknown[]) => (c[0] as { url: string }).url);
            expect(calls[0]).toContain('start=0');
            expect(calls[1]).toContain('start=100');
            expect(calls[2]).toContain('start=200');
        });

        test('malformed page shape mid-pagination throws (no silent partial data)', async () => {
            const client = makeClient();
            const needed = new Set(['a.png', 'b.png']);

            requestUrl.mockResolvedValueOnce({
                status: 200,
                json: {
                    results: [{ title: 'a.png', version: { number: 1 }, _links: { download: '/dl/a' } }],
                    _links: { next: '/more' }
                },
                text: ''
            });
            // Second page: results is not an array.
            requestUrl.mockResolvedValueOnce({
                status: 200,
                json: { results: 'corrupt', _links: {} },
                text: ''
            });

            await expect(client.getAttachmentDownloadLinks('123', needed))
                .rejects.toThrow('Invalid response');
        });

        test('clamps needed-filename set to 50 (importer per-page cap)', async () => {
            const client = makeClient();
            const needed = new Set(Array.from({ length: 80 }, (_, i) => `f${i}.png`));

            // One page resolving 60 of them; loop must stop once the clamped
            // 50-name target is satisfied rather than chasing all 80.
            requestUrl.mockResolvedValueOnce({
                status: 200,
                json: {
                    results: Array.from({ length: 60 }, (_, i) => ({
                        title: `f${i}.png`,
                        version: { number: 1 },
                        _links: { download: `/dl/${i}` },
                    })),
                    _links: { next: '/more' }
                },
                text: ''
            });

            const links = await client.getAttachmentDownloadLinks('123', needed);
            expect(requestUrl).toHaveBeenCalledTimes(1);
            expect(links.size).toBeGreaterThanOrEqual(50);
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
