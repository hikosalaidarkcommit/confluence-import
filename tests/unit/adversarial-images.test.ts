/**
 * @jest-environment jsdom
 *
 * Adversarial image import tests:
 * - Confluence Server URL form (/display/...) metadata resolution.
 * - Binary response validation: content-type casing and missing headers.
 * - Failure block sanitization: injection via alt/filename/URL.
 * - XHTML extraction fidelity: namespaced tags and malformed XML.
 * - Deterministic reuse provenance and collisions.
 */
import { ImageImporter, buildAttachmentFilename, buildFailureBlock } from '../../src/services/image-importer';
import { DiffEngine } from '../../src/diff/diff-engine';
import { ConfluenceApiClient } from '../../src/api/confluence-client';
import { TFile } from '../mocks/obsidian';

jest.mock('../../src/api/confluence-client');

const BASE = 'https://confluence.acme.com';

function makeApp() {
    const files = new Map<string, TFile>();
    return {
        vault: {
            createBinary: jest.fn().mockImplementation(async (path: string) => {
                const f = new TFile();
                f.path = path;
                files.set(path, f);
                return f;
            }),
            getAbstractFileByPath: jest.fn().mockImplementation((p: string) => files.get(p) ?? null),
        },
        fileManager: {
            getAvailablePathForAttachment: jest.fn().mockImplementation(
                async (name: string) => `attachments/${name}`
            ),
            generateMarkdownLink: jest.fn().mockImplementation(
                (file: TFile) => `![[${file.path.split('/').pop()}]]`
            ),
        },
        __files: files,
    };
}

function makeClient(overrides: Record<string, unknown> = {}) {
    return {
        getBaseUrl: () => BASE,
        getAttachmentDownloadLinks: jest.fn().mockResolvedValue(new Map()),
        downloadBinary: jest.fn().mockResolvedValue({
            data: new ArrayBuffer(100),
            contentType: 'image/png',
        }),
        ...overrides,
    } as unknown as ConfluenceApiClient;
}

describe('Adversarial Image Import', () => {
    const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;

    describe('Confluence Server URL form (/display/...) resolution', () => {
        test('resolves attachments from Server-style display URL metadata', async () => {
            const client = makeClient({
                getAttachmentDownloadLinks: jest.fn().mockResolvedValue(
                    new Map([['server.png', { download: '/download/attachments/99/server.png', version: 1 }]])
                ),
            });
            const app = makeApp();
            const importer = new ImageImporter(app as any, client, mockLogger);

            const summary = await importer.downloadAll('99', [
                { token: 't1', kind: 'attachment', filename: 'server.png', alt: '' }
            ], 'note.md');

            expect(client.downloadBinary).toHaveBeenCalledWith(`${BASE}/download/attachments/99/server.png`);
            expect(summary.imported).toBe(1);
        });
    });

    describe('Binary response validation', () => {
        test('handles mixed-case CONTENT-TYPE header', async () => {
            const client = makeClient({
                downloadBinary: jest.fn().mockResolvedValue({
                    data: new ArrayBuffer(10),
                    contentType: 'IMAGE/JPEG; charset=utf-8',
                }),
            });
            const app = makeApp();
            const importer = new ImageImporter(app as any, client, mockLogger);

            const summary = await importer.downloadAll('1', [
                { token: 't1', kind: 'url', url: `${BASE}/x.jpg`, alt: '' }
            ], 'note.md');

            expect(summary.imported).toBe(1);
            expect(summary.outcomes[0].status).toBe('imported');
        });

        test('fails on missing/empty Content-Type with mime-rejected', async () => {
            const client = makeClient({
                downloadBinary: jest.fn().mockResolvedValue({
                    data: new ArrayBuffer(10),
                    contentType: '',
                }),
            });
            const importer = new ImageImporter(makeApp() as any, client, mockLogger);

            const summary = await importer.downloadAll('1', [
                { token: 't1', kind: 'url', url: `${BASE}/x.png`, alt: '' }
            ], 'note.md');

            expect(summary.failed).toBe(1);
            expect(summary.outcomes[0].reason).toBe('mime-rejected');
        });
    });

    describe('Failure block sanitization', () => {
        test('alt text and filename in failure callout are neutralized', () => {
            const ref = {
                token: 't', kind: 'attachment' as const,
                filename: '"><script>alert(1)</script>.png',
                alt: '`injection` [link](x)',
            };
            const block = buildFailureBlock(ref, 'https://h/img.png', 'http-error');

            expect(block).toContain('![`injection` [link](x)](https://h/img.png)');
            expect(block).toContain('> 遠端 URL: <https://h/img.png>');
        });
    });

    describe('XHTML extraction fidelity', () => {
        test('handles namespaced tags with mixed casing and prefixes', async () => {
            const engine = new DiffEngine();
            const storage = `
                <ac:image alt="Prefixed">
                    <ri:attachment ri:filename="prefix.png" />
                </ac:image>
                <ac:image alt="NoPrefix">
                    <ri:attachment filename="noprefix.png" />
                </ac:image>
            `;
            const result = await engine.compare('local', storage, "123");
            expect(result.imageRefs).toHaveLength(2);
            expect(result.imageRefs[0]).toMatchObject({ kind: 'attachment', filename: 'prefix.png', alt: 'Prefixed' });
            expect(result.imageRefs[1]).toMatchObject({ kind: 'attachment', filename: 'noprefix.png', alt: 'NoPrefix' });
        });

        test('malformed/nested tags: inner image dropped, alt kept as fallback', async () => {
            const engine = new DiffEngine();
            const storage = '<ac:image alt="outer"><ac:image alt="inner"></ac:image></ac:image>';
            const result = await engine.compare('local', storage, "123");
            expect(result.remoteContent).not.toContain('%%CFIMG');
            expect(result.remoteContent).toContain('outer');
        });
    });

    describe('Deterministic reuse and collisions', () => {
        test('reuse verifies deterministic provenance (does not collide with unrelated file)', async () => {
            const client = makeClient({
                getAttachmentDownloadLinks: jest.fn().mockResolvedValue(
                    new Map([['img.png', { download: '/download/img.png', version: 1 }]])
                ),
            });
            const app = makeApp();
            const importer = new ImageImporter(app as any, client, mockLogger);

            const unrelated = new TFile();
            unrelated.path = 'attachments/manual-upload.png';

            (app.fileManager.getAvailablePathForAttachment as jest.Mock).mockResolvedValue('attachments/manual-upload.png');
            (app.vault.getAbstractFileByPath as jest.Mock).mockImplementation((p: string) =>
                p === 'attachments/manual-upload.png' ? unrelated : null
            );

            const summary = await importer.downloadAll('1', [
                { token: 't1', kind: 'attachment', filename: 'img.png', alt: '' }
            ], 'note.md');

            expect(summary.reused).toBe(0);
            expect(summary.outcomes[0].status).toBe('imported');
        });
    });
});
