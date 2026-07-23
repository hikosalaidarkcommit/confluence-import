/**
 * @jest-environment jsdom
 *
 * Adversarial security tests:
 *  - callout title injection (CR/LF, Markdown structure, length, Unicode)
 *  - dangerous link schemes surviving conversion
 *  - searchContent shape validation
 *  - URL userinfo / scheme fail-closed in the host guard
 */
import { DiffEngine, sanitizeCalloutTitle, isSafeHref } from '../../src/diff/diff-engine';
import { ConfluenceApiClient, ConfluenceApiError } from '../../src/api/confluence-client';
import { ConfluenceSyncService } from '../../src/services/sync-service';
import { requestUrl } from 'obsidian';

// Mock TextEncoder for jsdom environment if missing
if (typeof TextEncoder === 'undefined') {
    const { TextEncoder } = require('util');
    (global as any).TextEncoder = TextEncoder;
}

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;

// ---------------------------------------------------------------------------
// 1. Callout title injection
// ---------------------------------------------------------------------------
describe('sanitizeCalloutTitle', () => {
    test('CR/LF collapsed — attacker cannot break out of the header line', () => {
        const out = sanitizeCalloutTitle('Title\n> [!danger] Fake\nInjected line\r\n# Heading');
        expect(out).not.toContain('\n');
        expect(out).not.toContain('\r');
    });

    test('Markdown structural characters are escaped', () => {
        const out = sanitizeCalloutTitle('[link](https://evil) `code` # > * _ ~ | ! -');
        expect(out).toContain('\\[');
        expect(out).toContain('\\]');
        expect(out).toContain('\\(');
        expect(out).toContain('\\)');
        expect(out).toContain('\\`');
        expect(out).toContain('\\#');
        expect(out).toContain('\\>');
        expect(out).toContain('\\*');
        expect(out).toContain('\\_');
        expect(out).toContain('\\~');
        expect(out).toContain('\\|');
        expect(out).toContain('\\!');
    });

    test('backslash escaped first (no double-unescape gadget)', () => {
        expect(sanitizeCalloutTitle('a\\b')).toBe('a\\\\b');
    });

    test('length capped', () => {
        const out = sanitizeCalloutTitle('x'.repeat(10_000));
        expect(out.length).toBeLessThanOrEqual(210);
    });

    test('Unicode preserved, unicode line separators collapsed', () => {
        const out = sanitizeCalloutTitle('中文標題\u2028next\u2029more');
        expect(out).toContain('中文標題');
        expect(out).not.toMatch(/[\u2028\u2029]/);
    });

    test('empty/whitespace-only → empty string', () => {
        expect(sanitizeCalloutTitle('')).toBe('');
        expect(sanitizeCalloutTitle('  \n\t ')).toBe('');
    });
});

describe('macro title injection end-to-end (real DiffEngine)', () => {
    test('multi-line malicious title cannot create extra callouts or headings', async () => {
        const engine = new DiffEngine();
        const evilTitle = 'Legit\n&gt; [!danger] Fake\n# Injected';
        const storage =
            '<structured-macro name="info">' +
            `<parameter name="title">Legit\n> [!danger] Fake\n# Injected</parameter>` +
            '<rich-text-body><p>body text</p></rich-text-body>' +
            '</structured-macro>';

        const result = await engine.compare('x', storage);
        const md = result.remoteContent;

        // Exactly one callout header, and no injected heading line
        const calloutHeaders = md.split('\n').filter(l => l.trim().startsWith('> [!'));
        expect(calloutHeaders).toHaveLength(1);
        expect(md.split('\n').some(l => l.startsWith('# Injected'))).toBe(false);
        expect(evilTitle).toBeTruthy();
    });

    test('callout type still whitelisted — unknown macro produces no callout', async () => {
        const engine = new DiffEngine();
        const storage =
            '<structured-macro name="totally-unknown-macro">' +
            '<rich-text-body><p>content here</p></rich-text-body>' +
            '</structured-macro>';
        const result = await engine.compare('x', storage);
        expect(result.remoteContent).not.toContain('[!');
    });
});

// ---------------------------------------------------------------------------
// 2. Dangerous link schemes
// ---------------------------------------------------------------------------
describe('isSafeHref', () => {
    test.each([
        ['javascript:alert(1)', false],
        ['JAVASCRIPT:alert(1)', false],
        ['Java\tScript:alert(1)', false],
        [' javascript:alert(1)', false],
        ['java\nscript:alert(1)', false],
        ['%6Aavascript:alert(1)', false],
        ['data:text/html,<script>alert(1)</script>', false],
        ['vbscript:msgbox(1)', false],
        ['file:///etc/passwd', false],
        ['obsidian://open?vault=x', false],
        ['ftp://example.com/x', false], // default-deny exotic schemes
        ['https://example.com/page(1)', true],
        ['http://example.com', true],
        ['mailto:user@example.com', true],
        ['/wiki/spaces/X/pages/1', true],
        ['#anchor', true],
        ['relative/path.md', true],
        ['', true],
    ])('%s → safe=%s', (href, expected) => {
        expect(isSafeHref(href)).toBe(expected);
    });
});

describe('dangerous links stripped during conversion (real DiffEngine)', () => {
    test('javascript: link becomes plain text; https link survives', async () => {
        const engine = new DiffEngine();
        const storage =
            '<p><a href="javascript:alert(1)">click me</a> and ' +
            '<a href="https://example.com/ok">good link</a></p>';
        const result = await engine.compare('x', storage);
        const md = result.remoteContent;

        expect(md).not.toContain('javascript:');
        expect(md).toContain('click me');           // text preserved
        expect(md).toContain('https://example.com/ok'); // legit link kept
        expect(md).toMatch(/\[good link\]\(https:\/\/example\.com\/ok\)/);
    });

    test('data: and obfuscated schemes stripped; parentheses in legit URLs intact', async () => {
        const engine = new DiffEngine();
        const storage =
            '<p><a href="DATA:text/html,x">d</a>' +
            '<a href=" javascript:x">j</a>' +
            '<a href="https://en.wikipedia.org/wiki/Foo_(bar)">wiki</a></p>';
        const result = await engine.compare('x', storage);
        const md = result.remoteContent;

        expect(md.toLowerCase()).not.toContain('data:text/html');
        expect(md).not.toMatch(/\]\(\s*javascript:/i);
        // Legit link survives; Turndown may escape parens inside the URL
        // (valid Markdown), so accept either form.
        expect(md).toMatch(/Foo_\\?\(bar\\?\)/);
        expect(md).toContain('[wiki](');
    });
});

// ---------------------------------------------------------------------------
// 3. searchContent shape validation
// ---------------------------------------------------------------------------
describe('searchContent shape validation', () => {
    const config = { baseUrl: 'https://x.atlassian.net', email: 'a@b.co', apiToken: 't' };

    function mockResponse(json: any) {
        (requestUrl as jest.Mock).mockResolvedValue({ status: 200, json });
    }

    beforeEach(() => jest.clearAllMocks());

    test('valid results pass through', async () => {
        mockResponse({
            results: [{ id: '1', title: 'T', version: { number: 3 }, space: { key: 'SP' } }],
            size: 1,
        });
        const client = new ConfluenceApiClient(config);
        const res = await client.searchContent({ spaceKey: 'SP', title: 'T' });
        expect(res.results).toHaveLength(1);
    });

    test('empty results array is a normal not-found (no throw)', async () => {
        mockResponse({ results: [], size: 0 });
        const client = new ConfluenceApiClient(config);
        const res = await client.searchContent({ spaceKey: 'SP', title: 'T' });
        expect(res.results).toHaveLength(0);
    });

    test.each([
        ['null body', null],
        ['missing results', {}],
        ['results not array', { results: 'nope' }],
        ['entry null', { results: [null] }],
        ['entry missing id', { results: [{ title: 'T', version: { number: 1 }, space: { key: 'S' } }] }],
        ['version not number', { results: [{ id: '1', title: 'T', version: { number: 'x' }, space: { key: 'S' } }] }],
        ['version NaN', { results: [{ id: '1', title: 'T', version: { number: NaN }, space: { key: 'S' } }] }],
        ['version negative', { results: [{ id: '1', title: 'T', version: { number: -2 }, space: { key: 'S' } }] }],
        ['version non-integer', { results: [{ id: '1', title: 'T', version: { number: 1.5 }, space: { key: 'S' } }] }],
        ['missing space key', { results: [{ id: '1', title: 'T', version: { number: 1 } }] }],
    ])('%s → typed ConfluenceApiError without raw body', async (_name, json) => {
        mockResponse(json);
        const client = new ConfluenceApiClient(config);
        await expect(client.searchContent({ spaceKey: 'SP', title: 'T' }))
            .rejects.toThrow(ConfluenceApiError);
        try {
            mockResponse(json);
            await client.searchContent({ spaceKey: 'SP', title: 'T' });
        } catch (e: any) {
            // Error must not leak the raw response body
            expect(String(e.message)).not.toContain('nope');
            expect(e.status).toBe(0);
        }
    });

    test('getPage rejects non-finite / non-positive version numbers', async () => {
        const bad = [Infinity, NaN, 0, -1, 2.5];
        for (const v of bad) {
            mockResponse({ id: '1', title: 'T', body: { storage: { value: 'x' } }, version: { number: v } });
            const client = new ConfluenceApiClient(config);
            await expect(client.getPage('1')).rejects.toThrow(ConfluenceApiError);
        }
    });
});

// ---------------------------------------------------------------------------
// 4. Host guard: userinfo & scheme fail-closed
// ---------------------------------------------------------------------------
describe('host guard userinfo/scheme fail-closed', () => {
    const settings = {
        baseUrl: 'https://example.atlassian.net',
        apiToken: 'tok',
        userEmail: 'u@e.co',
        enableDebugLogging: false,
        enablePageIdCache: true,
    } as any;

    function makeApp(noteUrl: string) {
        return {
            vault: { read: jest.fn().mockResolvedValue('---\nconfluence-url: ' + noteUrl + '\n---\nbody'), modify: jest.fn(), adapter: {} },
            metadataCache: { getFileCache: jest.fn().mockReturnValue({ frontmatter: { 'confluence-url': noteUrl } }) },
            fileManager: { processFrontMatter: jest.fn() },
        } as any;
    }

    async function expectBlocked(noteUrl: string) {
        const app = makeApp(noteUrl);
        const service = new ConfluenceSyncService(app, settings, mockLogger);
        await service.syncFromConfluence({ path: 'n.md', extension: 'md' } as any);
        // Fail closed: error logged, nothing written
        expect(mockLogger.error).toHaveBeenCalled();
        expect(app.vault.modify).not.toHaveBeenCalled();
    }

    beforeEach(() => jest.clearAllMocks());

    test('userinfo in note URL blocked', async () => {
        await expectBlocked('https://user:pass@example.atlassian.net/wiki/spaces/S/pages/1/T');
    });

    test('username-only userinfo blocked', async () => {
        await expectBlocked('https://user@example.atlassian.net/wiki/spaces/S/pages/1/T');
    });

    test('file: scheme blocked', async () => {
        await expectBlocked('file:///etc/passwd/wiki/spaces/S/pages/1/T');
    });

    test('javascript: scheme blocked (malformed URL path)', async () => {
        await expectBlocked('javascript:alert(1)');
    });

    test('IDN homograph host mismatch blocked', async () => {
        // xn--... punycode host differs from configured ASCII host
        await expectBlocked('https://еxample.atlassian.net/wiki/spaces/S/pages/1/T'); // Cyrillic е
    });

    test('same host with non-standard port mismatch blocked', async () => {
        await expectBlocked('https://example.atlassian.net:8443/wiki/spaces/S/pages/1/T');
    });
});
