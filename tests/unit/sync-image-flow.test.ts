/**
 * End-to-end image flow through the sync service apply path:
 * order of operations (downloads → second stale check → writes), rollback
 * on stale/unload/modify-failure, cancel creates nothing, setting off =
 * remote links without failure callouts and zero network.
 */
import { ConfluenceSyncService } from '../../src/services/sync-service';
import { DiffEngine } from '../../src/diff/diff-engine';
import { ConfluenceApiClient } from '../../src/api/confluence-client';
import { CachedPageResolver } from '../../src/api/page-resolver';
import { ConflictResolutionModal } from '../../src/ui/conflict-modal';
import { RemoteImageRef } from '../../src/models';
import { TFile, Notice } from '../mocks/obsidian';

jest.mock('../../src/api/confluence-client', () => {
    const actual = jest.requireActual('../../src/api/confluence-client');
    return {
        ...actual,
        ConfluenceApiClient: jest.fn(),
    };
});
jest.mock('../../src/api/page-resolver');
jest.mock('../../src/diff/diff-engine', () => {
    const actual = jest.requireActual('../../src/diff/diff-engine');
    return {
        ...actual,
        DiffEngine: jest.fn(),
    };
});
jest.mock('../../src/ui/conflict-modal');

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;

const NOTE = '---\nconfluence-url: https://example.atlassian.net/wiki/spaces/SP/pages/12345/My+Page\n---\nlocal body';
const TOKEN = '%%CFIMG-aaaaaaaaaaaa-0%%';

const settings = {
    baseUrl: 'https://example.atlassian.net',
    apiToken: 'token',
    userEmail: 'user@example.com',
    enableDebugLogging: false,
    enablePageIdCache: false,
    importImages: true,
} as never;

function makeFile(path = 'note.md') {
    return { path, basename: 'note', extension: 'md' } as never;
}

function imageRef(): RemoteImageRef {
    return { token: TOKEN, kind: 'attachment', filename: 'diagram.png', alt: 'diagram' };
}

function makeApp(overrides: Record<string, unknown> = {}) {
    const created = new Map<string, TFile>();
    return {
        vault: {
            read: jest.fn().mockResolvedValue(NOTE),
            modify: jest.fn().mockResolvedValue(undefined),
            createBinary: jest.fn().mockImplementation(async (path: string) => {
                const f = new TFile();
                f.path = path;
                created.set(path, f);
                return f;
            }),
            getAbstractFileByPath: jest.fn().mockImplementation((p: string) => created.get(p) ?? null),
            adapter: {},
        },
        metadataCache: {
            getFileCache: jest.fn().mockReturnValue({
                frontmatter: {
                    'confluence-url': 'https://example.atlassian.net/wiki/spaces/SP/pages/12345/My+Page',
                },
            }),
        },
        fileManager: {
            processFrontMatter: jest.fn().mockResolvedValue(undefined),
            getAvailablePathForAttachment: jest.fn().mockImplementation(async (n: string) => `attachments/${n}`),
            generateMarkdownLink: jest.fn().mockImplementation((f: TFile) => `![[${f.path.split('/').pop()}]]`),
            trashFile: jest.fn().mockResolvedValue(undefined),
        },
        __created: created,
        ...overrides,
    } as never;
}

function setupMocks(options: {
    imageRefs?: RemoteImageRef[];
    downloadBinary?: jest.Mock;
    getLinks?: jest.Mock;
    modalKind?: 'accept' | 'cancel';
} = {}) {
    const downloadBinary = options.downloadBinary ?? jest.fn().mockResolvedValue({
        data: new ArrayBuffer(2048),
        contentType: 'image/png',
    });
    const getLinks = options.getLinks ?? jest.fn().mockResolvedValue(
        new Map([['diagram.png', '/download/attachments/12345/diagram.png']])
    );

    (ConfluenceApiClient as unknown as jest.Mock).mockImplementation(() => ({
        getPage: jest.fn().mockResolvedValue({
            id: '12345', title: 'My Page',
            body: { storage: { value: '<p>remote body</p>', representation: 'storage' } },
            version: { number: 7, when: '' },
            space: { key: 'SP', name: 'Space' },
        }),
        getAttachmentDownloadLinks: getLinks,
        downloadBinary,
        getBaseUrl: () => 'https://example.atlassian.net',
    }));

    (CachedPageResolver as unknown as jest.Mock).mockImplementation(() => ({
        resolvePageId: jest.fn().mockResolvedValue({ pageId: '12345', version: 7, title: 'My Page', spaceKey: 'SP' }),
        updateApiClient: jest.fn(),
    }));

    const { ConfluencePageResolver } = jest.requireMock('../../src/api/page-resolver');
    (ConfluencePageResolver as jest.Mock).mockImplementation(() => ({
        resolvePageId: jest.fn().mockResolvedValue({ pageId: '12345', version: 7, title: 'My Page', spaceKey: 'SP' }),
    }));

    (DiffEngine as unknown as jest.Mock).mockImplementation(() => ({
        compare: jest.fn().mockResolvedValue({
            hasConflicts: true,
            isIdentical: false,
            remoteVersion: 0,
            remoteContent: `intro\n\n${TOKEN}\n\noutro`,
            localContent: 'local body',
            imageRefs: options.imageRefs ?? [imageRef()],
        }),
    }));

    (ConflictResolutionModal as unknown as jest.Mock).mockImplementation(
        (_app: unknown, _diff: unknown, onAccept: () => Promise<void>, onSettled?: () => void) => ({
            open: jest.fn().mockImplementation(() => {
                if ((options.modalKind ?? 'accept') === 'accept') {
                    onAccept().then(() => onSettled?.()).catch(() => onSettled?.());
                } else {
                    onSettled?.();
                }
            }),
            close: jest.fn(),
        })
    );

    return { downloadBinary, getLinks };
}

describe('sync image flow', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Notice.reset();
    });

    test('success: image downloaded, written to default attachment path, token replaced with local embed', async () => {
        setupMocks();
        const app = makeApp();
        const service = new ConfluenceSyncService(app as never, settings, mockLogger);

        await service.syncFromConfluence(makeFile());

        const vault = (app as never as { vault: { modify: jest.Mock; createBinary: jest.Mock } }).vault;
        expect(vault.createBinary).toHaveBeenCalledTimes(1);
        const written: string = vault.modify.mock.calls[0][1];
        expect(written).toContain('![[confluence-12345-');
        expect(written).not.toContain('%%CFIMG');
        expect(written).toContain('intro');
        expect(written).toContain('outro');
    });

    test('partial failure: body still written, failed image keeps remote URL + Chinese callout, version updated', async () => {
        const downloadBinary = jest.fn().mockRejectedValue(new Error('network'));
        setupMocks({ downloadBinary });
        const app = makeApp();
        const service = new ConfluenceSyncService(app as never, settings, mockLogger);

        await service.syncFromConfluence(makeFile());

        const vault = (app as never as { vault: { modify: jest.Mock; createBinary: jest.Mock } }).vault;
        expect(vault.modify).toHaveBeenCalledTimes(1);
        const written: string = vault.modify.mock.calls[0][1];
        expect(written).toContain('> [!warning] 圖片未匯入');
        expect(written).toContain('遠端 URL: <https://example.atlassian.net/download/attachments/12345/diagram.png>');
        expect(written).not.toContain('%%CFIMG');
        expect(vault.createBinary).not.toHaveBeenCalled();
        const fm = (app as never as { fileManager: { processFrontMatter: jest.Mock } }).fileManager;
        expect(fm.processFrontMatter).toHaveBeenCalled();
    });

    test('external image: no download call, kept remote with safety notice', async () => {
        const { downloadBinary } = setupMocks({
            imageRefs: [{ token: TOKEN, kind: 'url', url: 'https://cdn.example.org/x.png', alt: 'ext' }],
        });
        const app = makeApp();
        const service = new ConfluenceSyncService(app as never, settings, mockLogger);

        await service.syncFromConfluence(makeFile());

        expect(downloadBinary).not.toHaveBeenCalled();
        const written: string = (app as never as { vault: { modify: jest.Mock } }).vault.modify.mock.calls[0][1];
        expect(written).toContain('外部圖片未匯入');
        expect(written).toContain('https://cdn.example.org/x.png');
    });

    test('stale between download and write: rollback, nothing written', async () => {
        setupMocks();
        const app = makeApp();
        // First read (metadata) + snapshot + first stale check return NOTE;
        // the read AFTER downloads returns changed content.
        const vault = (app as never as { vault: { read: jest.Mock; modify: jest.Mock; createBinary: jest.Mock } }).vault;
        vault.read
            .mockResolvedValueOnce(NOTE)   // step 4 local read
            .mockResolvedValueOnce(NOTE)   // first stale check
            .mockResolvedValueOnce(NOTE + '\nEXTERNAL EDIT'); // second stale check
        const service = new ConfluenceSyncService(app as never, settings, mockLogger);

        await service.syncFromConfluence(makeFile());

        expect(vault.modify).not.toHaveBeenCalled();
        expect(vault.createBinary).not.toHaveBeenCalled(); // buffers never written
        const warn = Notice.messages.find((m: string) => m.includes('modified while'));
        expect(warn).toBeTruthy();
    });

    test('note modify failure: created attachments are trashed (rollback)', async () => {
        setupMocks();
        const app = makeApp();
        const vault = (app as never as { vault: { modify: jest.Mock; createBinary: jest.Mock } }).vault;
        vault.modify.mockRejectedValue(new Error('disk full'));
        const service = new ConfluenceSyncService(app as never, settings, mockLogger);

        await service.syncFromConfluence(makeFile());

        expect(vault.createBinary).toHaveBeenCalledTimes(1);
        const fm = (app as never as { fileManager: { trashFile: jest.Mock; processFrontMatter: jest.Mock } }).fileManager;
        expect(fm.trashFile).toHaveBeenCalledTimes(1);
        expect(fm.processFrontMatter).not.toHaveBeenCalled(); // version NOT advanced
    });

    test('cancel: no downloads, no writes, no created files', async () => {
        const { downloadBinary } = setupMocks({ modalKind: 'cancel' });
        const app = makeApp();
        const service = new ConfluenceSyncService(app as never, settings, mockLogger);

        await service.syncFromConfluence(makeFile());

        expect(downloadBinary).not.toHaveBeenCalled();
        const vault = (app as never as { vault: { modify: jest.Mock; createBinary: jest.Mock } }).vault;
        expect(vault.modify).not.toHaveBeenCalled();
        expect(vault.createBinary).not.toHaveBeenCalled();
    });

    test('importImages=false: no network, remote links, no failure callout', async () => {
        const { downloadBinary, getLinks } = setupMocks({
            imageRefs: [{ token: TOKEN, kind: 'url', url: 'https://example.atlassian.net/download/attachments/12345/d.png', alt: 'pic' }],
        });
        const app = makeApp();
        const offSettings = { ...(settings as Record<string, unknown>), importImages: false } as never;
        const service = new ConfluenceSyncService(app as never, offSettings, mockLogger);

        await service.syncFromConfluence(makeFile());

        expect(downloadBinary).not.toHaveBeenCalled();
        expect(getLinks).not.toHaveBeenCalled();
        const written: string = (app as never as { vault: { modify: jest.Mock } }).vault.modify.mock.calls[0][1];
        expect(written).toContain('![pic](https://example.atlassian.net/download/attachments/12345/d.png)');
        expect(written).not.toContain('圖片未匯入'); // no failure callout when disabled
        expect(written).not.toContain('%%CFIMG');
    });
});
