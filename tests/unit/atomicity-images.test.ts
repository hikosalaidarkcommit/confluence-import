/**
 * @jest-environment jsdom
 * 
 * Atomicity and rollback tests for image import.
 * Ensures that partial successes are cleaned up on failures or unload.
 */
import { ConfluenceSyncService } from '../../src/services/sync-service';
import { DiffEngine } from '../../src/diff/diff-engine';
import { ConfluenceApiClient } from '../../src/api/confluence-client';
import { CachedPageResolver, ConfluencePageResolver } from '../../src/api/page-resolver';
import { ConflictResolutionModal } from '../../src/ui/conflict-modal';
import { TFile, Notice } from '../mocks/obsidian';

jest.mock('../../src/api/confluence-client');
jest.mock('../../src/api/page-resolver');
jest.mock('../../src/diff/diff-engine', () => {
    const actual = jest.requireActual('../../src/diff/diff-engine');
    return {
        ...actual,
        DiffEngine: jest.fn(),
    };
});
jest.mock('../../src/ui/conflict-modal');

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;

const settings = {
    baseUrl: 'https://example.atlassian.net',
    apiToken: 'token',
    userEmail: 'user@example.com',
    enableDebugLogging: false,
    enablePageIdCache: false,
    importImages: true,
};

function makeApp(overrides: Record<string, unknown> = {}) {
    const files = new Map<string, TFile>();
    return {
        vault: {
            read: jest.fn().mockResolvedValue('---\nconfluence-url: https://example.atlassian.net/wiki/spaces/S/pages/1\n---\nbody'),
            modify: jest.fn().mockResolvedValue(undefined),
            createBinary: jest.fn().mockImplementation(async (path: string) => {
                const f = new TFile();
                f.path = path;
                files.set(path, f);
                return f;
            }),
            getAbstractFileByPath: jest.fn().mockImplementation((p: string) => files.get(p) ?? null),
        },
        metadataCache: {
            getFileCache: jest.fn().mockReturnValue({
                frontmatter: { 'confluence-url': 'https://example.atlassian.net/wiki/spaces/S/pages/1' },
            }),
        },
        fileManager: {
            processFrontMatter: jest.fn().mockResolvedValue(undefined),
            getAvailablePathForAttachment: jest.fn().mockImplementation(async (n: string) => `attachments/${n}`),
            generateMarkdownLink: jest.fn().mockImplementation((f: TFile) => `![[${f.path.split('/').pop()}]]`),
            trashFile: jest.fn().mockResolvedValue(undefined),
        },
        __files: files,
        ...overrides,
    };
}

function setupServiceMocks() {
    (ConfluencePageResolver as unknown as jest.Mock).mockImplementation(() => ({
        resolvePageId: jest.fn().mockResolvedValue({ pageId: '1', version: 1, title: 'T', spaceKey: 'S' }),
    }));
    (CachedPageResolver as unknown as jest.Mock).mockImplementation(() => ({
        resolvePageId: jest.fn().mockResolvedValue({ pageId: '1', version: 1, title: 'T', spaceKey: 'S' }),
        updateApiClient: jest.fn(),
    }));
    (DiffEngine as unknown as jest.Mock).mockImplementation(() => ({
        compare: jest.fn().mockResolvedValue({
            hasConflicts: true, isIdentical: false, remoteVersion: 0,
            remoteContent: '%%CFIMG-a-0%%', localContent: 'body',
            imageRefs: [{ token: '%%CFIMG-a-0%%', kind: 'attachment', filename: 'a.png', alt: '' }],
        }),
    }));
}

describe('Atomicity and Rollback', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Notice.reset();
        setupServiceMocks();
    });

    test('rollback on note modify failure after image writes', async () => {
        const app = makeApp();
        app.vault.modify.mockRejectedValue(new Error('disk full'));
        
        const client: any = {
            getPage: jest.fn().mockResolvedValue({
                id: '1', title: 'T', body: { storage: { value: 'x' } }, version: { number: 1 }, space: { key: 'S' }
            }),
            getAttachmentDownloadLinks: jest.fn().mockResolvedValue(new Map([['a.png', { download: '/dl/a.png', version: 1 }]])),
            downloadBinary: jest.fn().mockResolvedValue({ data: new ArrayBuffer(10), contentType: 'image/png' }),
            getBaseUrl: () => 'https://example.atlassian.net',
        };
        (ConfluenceApiClient as unknown as jest.Mock).mockImplementation(() => client);

        let onAcceptCb: () => Promise<void>;
        (ConflictResolutionModal as unknown as jest.Mock).mockImplementation((_a, _d, onAccept, onSettled) => {
            onAcceptCb = onAccept;
            return { 
                open: jest.fn().mockImplementation(async () => {
                    try {
                        await onAcceptCb();
                    } catch (e) {
                        // modal stays open in reality, but test needs to settle to finish
                    } finally {
                        onSettled?.();
                    }
                }), 
                close: jest.fn() 
            };
        });

        const service = new ConfluenceSyncService(app as any, settings as any, mockLogger);
        await service.syncFromConfluence({ path: 'note.md', extension: 'md' } as any);

        expect(app.vault.createBinary).toHaveBeenCalled();
        expect(app.vault.modify).toHaveBeenCalled();
        expect(app.fileManager.trashFile).toHaveBeenCalled();
        expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
    });

    test('rollback on unload during downloads', async () => {
        const app = makeApp();
        
        const client: any = {
            getPage: jest.fn().mockResolvedValue({
                id: '1', title: 'T', body: { storage: { value: 'x' } }, version: { number: 1 }, space: { key: 'S' }
            }),
            getAttachmentDownloadLinks: jest.fn().mockResolvedValue(new Map([['a.png', { download: '/dl/a.png', version: 1 }]])),
            downloadBinary: jest.fn().mockImplementation(() => {
                service.unload();
                return Promise.resolve({ data: new ArrayBuffer(10), contentType: 'image/png' });
            }),
            getBaseUrl: () => 'https://example.atlassian.net',
        };
        (ConfluenceApiClient as unknown as jest.Mock).mockImplementation(() => client);

        let onAcceptCb: () => Promise<void>;
        (ConflictResolutionModal as unknown as jest.Mock).mockImplementation((_a, _d, onAccept, onSettled) => {
            onAcceptCb = onAccept;
            return { 
                open: jest.fn().mockImplementation(async () => {
                    try {
                        await onAcceptCb();
                    } catch (e) {
                        // expected abort
                    } finally {
                        onSettled?.();
                    }
                }), 
                close: jest.fn() 
            };
        });

        const service = new ConfluenceSyncService(app as any, settings as any, mockLogger);
        await service.syncFromConfluence({ path: 'note.md', extension: 'md' } as any);

        expect(app.vault.createBinary).not.toHaveBeenCalled();
        expect(mockLogger.error).toHaveBeenCalledWith('Error while applying pulled content locally', expect.any(Error));
    });

    test('rollback on stale note after image writes (third stale check)', async () => {
        const app = makeApp();
        const original = '---\nconfluence-url: https://example.atlassian.net/wiki/spaces/S/pages/1\n---\nbody';
        const externalEdit = '---\nconfluence-url: https://example.atlassian.net/wiki/spaces/S/pages/1\n---\nexternally edited';
        
        // Step 4 read
        app.vault.read.mockResolvedValueOnce(original);
        // FIRST stale check
        app.vault.read.mockResolvedValueOnce(original);
        // SECOND stale check
        app.vault.read.mockResolvedValueOnce(original);
        // THIRD stale check (immediately before write) returns external edit
        app.vault.read.mockResolvedValueOnce(externalEdit);

        const client: any = {
            getPage: jest.fn().mockResolvedValue({
                id: '1', title: 'T', body: { storage: { value: 'x' } }, version: { number: 1 }, space: { key: 'S' }
            }),
            getAttachmentDownloadLinks: jest.fn().mockResolvedValue(new Map([['a.png', { download: '/dl/a.png', version: 1 }]])),
            downloadBinary: jest.fn().mockResolvedValue({ data: new ArrayBuffer(10), contentType: 'image/png' }),
            getBaseUrl: () => 'https://example.atlassian.net',
        };
        (ConfluenceApiClient as unknown as jest.Mock).mockImplementation(() => client);

        let onAcceptCb: () => Promise<void>;
        (ConflictResolutionModal as unknown as jest.Mock).mockImplementation((_a, _d, onAccept, onSettled) => {
            onAcceptCb = onAccept;
            return { 
                open: jest.fn().mockImplementation(async () => {
                    try {
                        await onAcceptCb();
                    } catch (e) {
                        // expected abort
                    } finally {
                        onSettled?.();
                    }
                }), 
                close: jest.fn() 
            };
        });

        const service = new ConfluenceSyncService(app as any, settings as any, mockLogger);
        await service.syncFromConfluence({ path: 'note.md', extension: 'md' } as any);

        // Files were written
        expect(app.vault.createBinary).toHaveBeenCalled();
        // But note write was aborted
        expect(app.vault.modify).not.toHaveBeenCalled();
        // And files were rolled back
        expect(app.fileManager.trashFile).toHaveBeenCalled();
    });
});
