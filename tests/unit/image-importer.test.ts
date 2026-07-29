/**
 * Image import pipeline tests: pure helpers, origin security, MIME/size
 * limits, replacement building, reuse, and rollback.
 */
import {
    ImageImporter,
    MAX_IMAGE_BYTES,
    MAX_IMAGES_PER_PAGE,
    MAX_TOTAL_BYTES,
    buildAttachmentFilename,
    buildFailureBlock,
    buildExternalRemoteBlock,
    escapeUrlForMarkdown,
    extensionForMime,
} from '../../src/services/image-importer';
import { resolveDownloadUrl } from '../../src/utils/url-utils';
import { deterministicHash, buildImageToken, sanitizeImageText } from '../../src/diff/diff-engine';
import { ConfluenceApiClient } from '../../src/api/confluence-client';
import { RemoteImageRef } from '../../src/models';
import { TFile } from '../mocks/obsidian';

jest.mock('../../src/api/confluence-client');

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;

const BASE = 'https://example.atlassian.net';

function ref(partial: Partial<RemoteImageRef>): RemoteImageRef {
    return { token: '%%CFIMG-abc-0%%', kind: 'attachment', alt: '', ...partial };
}

function makeApp(overrides: Record<string, unknown> = {}) {
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
            trashFile: jest.fn().mockResolvedValue(undefined),
        },
        __files: files,
        ...overrides,
    };
}

function makeClient(overrides: Record<string, unknown> = {}) {
    return {
        getBaseUrl: () => BASE,
        getAttachmentDownloadLinks: jest.fn().mockResolvedValue(
            new Map([['diagram.png', { download: '/download/attachments/12345/diagram.png', version: 1 }]])
        ),
        downloadBinary: jest.fn().mockResolvedValue({
            data: new ArrayBuffer(1024),
            contentType: 'image/png',
        }),
        ...overrides,
    } as unknown as ConfluenceApiClient;
}

describe('pure helpers', () => {
    test('deterministicHash is stable and hex', () => {
        expect(deterministicHash('abc')).toBe(deterministicHash('abc'));
        expect(deterministicHash('abc')).toMatch(/^[0-9a-f]{16}$/);
        expect(deterministicHash('abc')).not.toBe(deterministicHash('abd'));
    });

    test('buildImageToken deterministic per identity+index', () => {
        expect(buildImageToken('attachment:x.png', 0)).toBe(buildImageToken('attachment:x.png', 0));
        expect(buildImageToken('attachment:x.png', 0)).not.toBe(buildImageToken('attachment:x.png', 1));
        expect(buildImageToken('a', 0)).toMatch(/^%%CFIMG-[0-9a-f]{12}-0%%$/);
    });

    test('sanitizeImageText: single line, escaped, bounded', () => {
        const out = sanitizeImageText('a\nb [x](y) `z`' + 'q'.repeat(300));
        expect(out).not.toContain('\n');
        expect(out).toContain('\\[');
        expect(out).toContain('\\`');
        expect(out.length).toBeLessThanOrEqual(130 * 2); // escapes may add backslashes
    });

    test('buildAttachmentFilename: plugin prefix, sanitized pageId, no path parts', () => {
        const name = buildAttachmentFilename('123/../45', 'attachment:e vil.png', 'png');
        expect(name).toMatch(/^confluence-12345-[0-9a-f]{12}\.png$/);
        expect(name).not.toContain('/');
        expect(name).not.toContain('..');
    });

    test('resolveDownloadUrl: same-origin relative ok; cross-origin/userinfo/scheme null', () => {
        expect(resolveDownloadUrl(BASE, '/download/x.png')).toBe(`${BASE}/download/x.png`);
        expect(resolveDownloadUrl(BASE, `${BASE}/download/y.png`)).toBe(`${BASE}/download/y.png`);
        expect(resolveDownloadUrl(BASE, 'https://evil.example.com/x.png')).toBeNull();
        expect(resolveDownloadUrl(BASE, 'https://user:pass@example.atlassian.net/x.png')).toBeNull();
        expect(resolveDownloadUrl(BASE, 'file:///etc/passwd')).toBeNull();
    });

    test('extensionForMime: allowlist only, SVG/HTML rejected', () => {
        expect(extensionForMime('image/png')).toBe('png');
        expect(extensionForMime('image/jpeg; charset=binary')).toBe('jpg');
        expect(extensionForMime('image/webp')).toBe('webp');
        expect(extensionForMime('image/svg+xml')).toBeNull();
        expect(extensionForMime('text/html')).toBeNull();
        expect(extensionForMime('')).toBeNull();
    });

    test('escapeUrlForMarkdown neutralizes backticks and angle brackets', () => {
        const out = escapeUrlForMarkdown('https://h/x`y<z>');
        expect(out).not.toContain('`');
        expect(out).not.toContain('<');
        expect(out).not.toContain('>');
    });

    test('buildFailureBlock: remote embed + Chinese callout with URL and reason', () => {
        const block = buildFailureBlock(ref({ alt: 'pic' }), 'https://h/img.png', 'http-error');
        expect(block).toContain('![pic](https://h/img.png)');
        expect(block).toContain('> [!warning] 圖片未匯入');
        expect(block).toContain('> 遠端 URL: <https://h/img.png>');
        expect(block).toContain('下載失敗');
    });

    test('buildExternalRemoteBlock: safety notice, not a failure label', () => {
        const block = buildExternalRemoteBlock(ref({ kind: 'url', alt: 'ext' }), 'https://other.example.com/i.png');
        expect(block).toContain('![ext](https://other.example.com/i.png)');
        expect(block).toContain('> [!info] 外部圖片未匯入');
        expect(block).toContain('遠端 URL:');
        expect(block).not.toContain('[!warning]');
    });

    test('applyReplacements replaces exact tokens only (no regex semantics)', () => {
        const t1 = buildImageToken('a', 0);
        const t2 = buildImageToken('b', 1);
        const md = `before\n${t1}\nmiddle ${t2} end`;
        const out = ImageImporter.applyReplacements(md, [
            { ref: ref({ token: t1 }), status: 'imported', replacement: '![[x.png]]' },
            { ref: ref({ token: t2 }), status: 'failed', replacement: 'FAIL-BLOCK' },
        ]);
        expect(out).toContain('![[x.png]]');
        expect(out).toContain('FAIL-BLOCK');
        expect(out).not.toContain('%%CFIMG');
    });
});

describe('downloadAll security & limits', () => {
    beforeEach(() => jest.clearAllMocks());

    test('external URL never triggers a network call and is kept-remote', async () => {
        const client = makeClient();
        const app = makeApp();
        const importer = new ImageImporter(app as never, client, mockLogger);

        const summary = await importer.downloadAll('12345', [
            ref({ kind: 'url', url: 'https://cdn.example.org/pic.png', token: buildImageToken('u', 0) }),
        ], 'note.md');

        expect((client as never as { downloadBinary: jest.Mock }).downloadBinary).not.toHaveBeenCalled();
        expect(summary.keptRemote).toBe(1);
        expect(summary.outcomes[0].status).toBe('kept-remote');
        expect(summary.outcomes[0].replacement).toContain('外部圖片未匯入');
    });

    test('attachment resolves via API metadata _links.download (never guessed)', async () => {
        const client = makeClient();
        const app = makeApp();
        const importer = new ImageImporter(app as never, client, mockLogger);

        const summary = await importer.downloadAll('12345', [
            ref({ filename: 'diagram.png', token: buildImageToken('a', 0) }),
        ], 'note.md');

        const dl = (client as never as { downloadBinary: jest.Mock }).downloadBinary;
        expect(dl).toHaveBeenCalledWith(`${BASE}/download/attachments/12345/diagram.png`);
        expect(summary.imported).toBe(1);
    });

    test('attachment missing from metadata fails with remote callout (no guessed URL)', async () => {
        const client = makeClient({
            getAttachmentDownloadLinks: jest.fn().mockResolvedValue(new Map()),
        });
        const app = makeApp();
        const importer = new ImageImporter(app as never, client, mockLogger);

        const summary = await importer.downloadAll('12345', [
            ref({ filename: 'ghost.png', token: buildImageToken('g', 0) }),
        ], 'note.md');

        expect((client as never as { downloadBinary: jest.Mock }).downloadBinary).not.toHaveBeenCalled();
        expect(summary.failed).toBe(1);
        expect(summary.outcomes[0].reason).toBe('metadata-missing');
        expect(summary.outcomes[0].replacement).toContain('圖片未匯入');
    });

    test('metadata download link resolving off-origin fails with origin-mismatch', async () => {
        const client = makeClient({
            getAttachmentDownloadLinks: jest.fn().mockResolvedValue(
                new Map([['x.png', { download: 'https://evil.example.com/x.png', version: 1 }]])
            ),
        });
        const importer = new ImageImporter(makeApp() as never, client, mockLogger);

        const summary = await importer.downloadAll('12345', [
            ref({ filename: 'x.png', token: buildImageToken('x', 0) }),
        ], 'note.md');

        expect((client as never as { downloadBinary: jest.Mock }).downloadBinary).not.toHaveBeenCalled();
        expect(summary.outcomes[0].reason).toBe('origin-mismatch');
    });

    test('MIME not in allowlist (SVG) is rejected', async () => {
        const client = makeClient({
            downloadBinary: jest.fn().mockResolvedValue({
                data: new ArrayBuffer(100), contentType: 'image/svg+xml',
            }),
        });
        const importer = new ImageImporter(makeApp() as never, client, mockLogger);
        const summary = await importer.downloadAll('12345', [
            ref({ filename: 'diagram.png', token: buildImageToken('s', 0) }),
        ], 'note.md');
        expect(summary.outcomes[0].reason).toBe('mime-rejected');
    });

    test('oversized image rejected (20MiB cap)', async () => {
        const client = makeClient({
            downloadBinary: jest.fn().mockResolvedValue({
                data: new ArrayBuffer(MAX_IMAGE_BYTES + 1), contentType: 'image/png',
            }),
        });
        const importer = new ImageImporter(makeApp() as never, client, mockLogger);
        const summary = await importer.downloadAll('12345', [
            ref({ filename: 'diagram.png', token: buildImageToken('big', 0) }),
        ], 'note.md');
        expect(summary.outcomes[0].reason).toBe('too-large');
    });

    test('count limit: refs beyond 50 fail with count-limit-exceeded', async () => {
        const client = makeClient();
        const importer = new ImageImporter(makeApp() as never, client, mockLogger);
        const refs = Array.from({ length: MAX_IMAGES_PER_PAGE + 2 }, (_, i) =>
            ref({ kind: 'url', url: 'https://elsewhere.example.com/i.png', token: buildImageToken('n', i) })
        );
        const summary = await importer.downloadAll('12345', refs, 'note.md');
        const failures = summary.outcomes.filter(o => o.reason === 'count-limit-exceeded');
        expect(failures).toHaveLength(2);
    });

    test('total budget enforced across images', async () => {
        // 18MiB per image (under the 20MiB per-image cap); 6 images = 108MiB
        // total, which exceeds the 100MiB budget on the 6th.
        const size = 18 * 1024 * 1024;
        const names = ['a', 'b', 'c', 'd', 'e', 'f'];
        const client = makeClient({
            getAttachmentDownloadLinks: jest.fn().mockResolvedValue(new Map(
                names.map(n => [`${n}.png`, { download: `/download/${n}.png`, version: 1 }])
            )),
            downloadBinary: jest.fn().mockResolvedValue({
                data: new ArrayBuffer(size), contentType: 'image/png',
            }),
        });
        const importer = new ImageImporter(makeApp() as never, client, mockLogger);
        const summary = await importer.downloadAll('12345',
            names.map((n, i) => ref({ filename: `${n}.png`, token: buildImageToken(n, i) })),
            'note.md');

        expect(summary.imported).toBe(5);
        const budgetFails = summary.outcomes.filter(o => o.reason === 'total-budget-exceeded');
        expect(budgetFails).toHaveLength(1);
        expect(MAX_TOTAL_BYTES).toBe(100 * 1024 * 1024);
    });
});

describe('write, reuse, rollback', () => {
    beforeEach(() => jest.clearAllMocks());

    test('writeBuffers creates files, finalizes local embed links, records createdPaths', async () => {
        const client = makeClient();
        const app = makeApp();
        const importer = new ImageImporter(app as never, client, mockLogger);

        const summary = await importer.downloadAll('12345', [
            ref({ filename: 'diagram.png', token: buildImageToken('d', 0), width: 300 }),
        ], 'note.md');
        await importer.writeBuffers(summary, 'note.md');

        expect(app.vault.createBinary).toHaveBeenCalledTimes(1);
        const path = (app.vault.createBinary as jest.Mock).mock.calls[0][0] as string;
        expect(path).toMatch(/^attachments\/confluence-12345-[0-9a-f]{12}\.png$/);
        expect(summary.createdPaths).toEqual([path]);
        // Local embed with width via wiki-embed size syntax and identity marker
        expect(summary.outcomes[0].replacement).toMatch(/^!\[\[confluence-12345-[0-9a-f]{12}\.png\|300\]\] <!-- confluence-import-image:[0-9a-f]{16} -->$/);
    });

    test('repeat pull reuses existing deterministic file (no second write, no trash)', async () => {
        const identity = 'attachment:12345:/download/img.png:1';
        const hash = deterministicHash(identity).slice(0, 12);
        const markerHash = deterministicHash(identity).slice(0, 16);
        const name = `confluence-12345-${hash}.png`;
        const path = `attachments/${name}`;

        const files: Record<string, TFile> = {};
        files[path] = new TFile(path);

        const app = makeApp(files);
        // Simulate Obsidian detecting an existing file and suggesting a suffixed path
        (app.fileManager.getAvailablePathForAttachment as jest.Mock).mockResolvedValue(`attachments/${name} 1.png`);
        // Manually seed the files map in the mock vault
        (app as any).vault.createBinary.mockImplementationOnce(() => { throw new Error('Should not write'); });
        (app as any).__files.set(path, files[path]);

        const client = makeClient({
            getAttachmentDownloadLinks: jest.fn().mockResolvedValue(
                new Map([['img.png', { download: '/download/img.png', version: 1 }]])
            ),
        });
        const importer = new ImageImporter(app as never, client, mockLogger);

        const summary = await importer.downloadAll('12345', [
            ref({ filename: 'img.png', token: 'TOKEN' }),
        ], 'note.md');

        expect(summary.imported).toBe(0);
        expect(summary.reused).toBe(1);
        expect(summary.outcomes[0].replacement).toContain(name);
        expect(summary.outcomes[0].replacement).toContain(`<!-- confluence-import-image:${markerHash} -->`);
        expect(app.vault.createBinary).not.toHaveBeenCalled();
    });

    test('repeat pull reuses existing deterministic file (no second write, no trash)', async () => {
        const client = makeClient();
        const app = makeApp();
        // Simulate existing plugin-owned file: available path gets " 1" suffix
        const existing = new TFile();
        existing.path = 'attachments/confluence-12345-0000000000ab.png';
        (app.fileManager.getAvailablePathForAttachment as jest.Mock).mockImplementation(
            async (name: string) => `attachments/${name.replace('.png', ' 1.png')}`
        );
        (app.vault.getAbstractFileByPath as jest.Mock).mockImplementation((p: string) =>
            p.startsWith('attachments/confluence-12345-') && !p.includes(' 1') ? existing : null
        );
        const importer = new ImageImporter(app as never, client, mockLogger);

        const summary = await importer.downloadAll('12345', [
            ref({ filename: 'diagram.png', token: buildImageToken('r', 0) }),
        ], 'note.md');
        await importer.writeBuffers(summary, 'note.md');

        expect(summary.reused).toBe(1);
        expect(app.vault.createBinary).not.toHaveBeenCalled();
        expect(summary.createdPaths).toEqual([]);
    });

    test('rollback trashes only files created in this attempt', async () => {
        const client = makeClient();
        const app = makeApp();
        const importer = new ImageImporter(app as never, client, mockLogger);

        const summary = await importer.downloadAll('12345', [
            ref({ filename: 'diagram.png', token: buildImageToken('rb', 0) }),
        ], 'note.md');
        await importer.writeBuffers(summary, 'note.md');
        expect(summary.createdPaths).toHaveLength(1);

        await importer.rollback(summary);
        expect(app.fileManager.trashFile).toHaveBeenCalledTimes(1);
        expect(summary.createdPaths).toEqual([]);
    });

    test('createBinary failure converts outcome to failed with write-failed callout', async () => {
        const client = makeClient();
        const app = makeApp();
        (app.vault.createBinary as jest.Mock).mockRejectedValue(new Error('disk full'));
        const importer = new ImageImporter(app as never, client, mockLogger);

        const summary = await importer.downloadAll('12345', [
            ref({ filename: 'diagram.png', token: buildImageToken('wf', 0) }),
        ], 'note.md');
        await importer.writeBuffers(summary, 'note.md');

        expect(summary.imported).toBe(0);
        expect(summary.failed).toBe(1);
        expect(summary.outcomes[0].reason).toBe('write-failed');
        expect(summary.outcomes[0].replacement).toContain('圖片未匯入');
    });
});
