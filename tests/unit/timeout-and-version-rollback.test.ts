/**
 * Final release-gap tests:
 *  A. 30s soft download timeout — fake timers, late resolve/reject discarded,
 *     no vault file from late results, pipeline continues.
 *  B. Frontmatter version failure after body write — safe rollback decision
 *     table (rollback when untouched; keep when user edited; report orphans;
 *     reused files never trashed; no success notice; lock released).
 */
import {
    ImageImporter,
    IMAGE_DOWNLOAD_TIMEOUT_MS,
    ImageTimeoutError,
} from '../../src/services/image-importer';
import { ConfluenceSyncService } from '../../src/services/sync-service';
import { DiffEngine, buildImageToken } from '../../src/diff/diff-engine';
import { ConfluenceApiClient } from '../../src/api/confluence-client';
import { CachedPageResolver } from '../../src/api/page-resolver';
import { ConflictResolutionModal } from '../../src/ui/conflict-modal';
import { RemoteImageRef } from '../../src/models';
import { TFile, Notice } from '../mocks/obsidian';

jest.mock('../../src/api/confluence-client', () => {
    const actual = jest.requireActual('../../src/api/confluence-client');
    return { ...actual, ConfluenceApiClient: jest.fn() };
});
jest.mock('../../src/api/page-resolver');
jest.mock('../../src/diff/diff-engine', () => {
    const actual = jest.requireActual('../../src/diff/diff-engine');
    return { ...actual, DiffEngine: jest.fn() };
});
jest.mock('../../src/ui/conflict-modal');

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;
const BASE = 'https://example.atlassian.net';
const TOKEN = buildImageToken('attachment:diagram.png', 0);
const NOTE = '---\nconfluence-url: https://example.atlassian.net/wiki/spaces/SP/pages/12345/My+Page\n---\nlocal body';

function attachmentRef(): RemoteImageRef {
    return { token: TOKEN, kind: 'attachment', filename: 'diagram.png', alt: 'diagram' };
}

// ---------------------------------------------------------------------------
// A. Soft timeout (ImageImporter level, fake timers)
// ---------------------------------------------------------------------------
describe('image download soft timeout', () => {
    function makeApp() {
        const created = new Map<string, TFile>();
        return {
            vault: {
                createBinary: jest.fn().mockImplementation(async (path: string) => {
                    const f = new TFile();
                    f.path = path;
                    created.set(path, f);
                    return f;
                }),
                getAbstractFileByPath: jest.fn().mockImplementation((p: string) => created.get(p) ?? null),
            },
            fileManager: {
                getAvailablePathForAttachment: jest.fn().mockImplementation(async (n: string) => `attachments/${n}`),
                generateMarkdownLink: jest.fn().mockImplementation((f: TFile) => `![[${f.path.split('/').pop()}]]`),
                trashFile: jest.fn().mockResolvedValue(undefined),
            },
        };
    }

    function makeClient(downloadBinary: jest.Mock) {
        return {
            getBaseUrl: () => BASE,
            getAttachmentDownloadLinks: jest.fn().mockResolvedValue(
                new Map([['diagram.png', { download: '/download/attachments/12345/diagram.png', version: 3 }]])
            ),
            downloadBinary,
        } as unknown as ConfluenceApiClient;
    }

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
    });
    afterEach(() => {
        jest.useRealTimers();
    });

    test('default timeout constant is 30s and injectable for tests', () => {
        expect(IMAGE_DOWNLOAD_TIMEOUT_MS).toBe(30_000);
    });

    test('download exceeding 30s fails with timeout reason; late resolve discarded, no vault file', async () => {
        let resolveLate!: (v: { data: ArrayBuffer; contentType: string }) => void;
        const neverResolves = new Promise<{ data: ArrayBuffer; contentType: string }>((res) => {
            resolveLate = res;
        });
        const downloadBinary = jest.fn().mockReturnValue(neverResolves);
        const app = makeApp();
        const importer = new ImageImporter(app as never, makeClient(downloadBinary), mockLogger);

        const promise = importer.downloadAll('12345', [attachmentRef()], 'note.md');
        await jest.advanceTimersByTimeAsync(IMAGE_DOWNLOAD_TIMEOUT_MS + 1);
        const summary = await promise;

        expect(summary.failed).toBe(1);
        expect(summary.outcomes[0].reason).toBe('timeout');
        expect(summary.outcomes[0].replacement).toContain('下載逾時');
        expect(summary.outcomes[0].replacement).toContain('圖片未匯入');

        // Late resolution after timeout: permanently discarded.
        resolveLate({ data: new ArrayBuffer(1024), contentType: 'image/png' });
        await Promise.resolve();
        await importer.writeBuffers(summary, 'note.md');
        expect(app.vault.createBinary).not.toHaveBeenCalled();
    });

    test('late REJECTION after timeout does not produce unhandled rejection', async () => {
        let rejectLate!: (e: Error) => void;
        const failsLate = new Promise<{ data: ArrayBuffer; contentType: string }>((_, rej) => {
            rejectLate = rej;
        });
        const importer = new ImageImporter(
            makeApp() as never, makeClient(jest.fn().mockReturnValue(failsLate)), mockLogger
        );

        const promise = importer.downloadAll('12345', [attachmentRef()], 'note.md');
        await jest.advanceTimersByTimeAsync(IMAGE_DOWNLOAD_TIMEOUT_MS + 1);
        const summary = await promise;
        expect(summary.outcomes[0].reason).toBe('timeout');

        // Late rejection must be swallowed by the attached handler.
        rejectLate(new Error('network died later'));
        await Promise.resolve();
        await Promise.resolve();
        // Reaching here without Jest reporting an unhandled rejection = pass.
    });

    test('after one timeout the next image still downloads (sequential continue)', async () => {
        const good = { data: new ArrayBuffer(512), contentType: 'image/png' };
        const hang = new Promise<never>(() => { /* never settles */ });
        const downloadBinary = jest.fn()
            .mockReturnValueOnce(hang)
            .mockResolvedValueOnce(good);
        const client = {
            getBaseUrl: () => BASE,
            getAttachmentDownloadLinks: jest.fn().mockResolvedValue(new Map([
                ['a.png', { download: '/download/a.png', version: 1 }],
                ['b.png', { download: '/download/b.png', version: 1 }],
            ])),
            downloadBinary,
        } as unknown as ConfluenceApiClient;
        const app = makeApp();
        const importer = new ImageImporter(app as never, client, mockLogger);

        const refs: RemoteImageRef[] = [
            { token: buildImageToken('a', 0), kind: 'attachment', filename: 'a.png', alt: '' },
            { token: buildImageToken('b', 1), kind: 'attachment', filename: 'b.png', alt: '' },
        ];
        const promise = importer.downloadAll('12345', refs, 'note.md');
        await jest.advanceTimersByTimeAsync(IMAGE_DOWNLOAD_TIMEOUT_MS + 1);
        const summary = await promise;

        expect(summary.failed).toBe(1);
        expect(summary.imported).toBe(1);
        expect(downloadBinary).toHaveBeenCalledTimes(2);
    });

    test('fast download well under the limit is unaffected', async () => {
        const importer = new ImageImporter(
            makeApp() as never,
            makeClient(jest.fn().mockResolvedValue({ data: new ArrayBuffer(256), contentType: 'image/png' })),
            mockLogger
        );
        const promise = importer.downloadAll('12345', [attachmentRef()], 'note.md');
        await jest.advanceTimersByTimeAsync(5);
        const summary = await promise;
        expect(summary.imported).toBe(1);
        expect(summary.failed).toBe(0);
    });

    test('injectable short timeout is honored (test-only option)', async () => {
        const hang = new Promise<never>(() => { /* never settles */ });
        const importer = new ImageImporter(
            makeApp() as never, makeClient(jest.fn().mockReturnValue(hang)), mockLogger,
            { downloadTimeoutMs: 1000 }
        );
        const promise = importer.downloadAll('12345', [attachmentRef()], 'note.md');
        await jest.advanceTimersByTimeAsync(1001);
        const summary = await promise;
        expect(summary.outcomes[0].reason).toBe('timeout');
    });

    test('ImageTimeoutError is a typed error', () => {
        const e = new ImageTimeoutError();
        expect(e.name).toBe('ImageTimeoutError');
    });
});

// ---------------------------------------------------------------------------
// B. Version-update failure recovery (sync-service level)
// ---------------------------------------------------------------------------
describe('frontmatter version failure recovery', () => {
    const settings = {
        baseUrl: BASE,
        apiToken: 'token',
        userEmail: 'user@example.com',
        enableDebugLogging: false,
        enablePageIdCache: false,
        importImages: true,
    } as never;

    function makeFile(path = 'note.md') {
        return { path, basename: 'note', extension: 'md' } as never;
    }

    function setup(options: {
        processFrontMatter?: jest.Mock;
        readSequence?: string[];
        modifyImpl?: jest.Mock;
        imageRefs?: RemoteImageRef[];
    } = {}) {
        const created = new Map<string, TFile>();
        const appliedContents: string[] = [];

        const modify = options.modifyImpl ?? jest.fn().mockImplementation(async (_f: unknown, content: string) => {
            appliedContents.push(content);
        });

        const read = jest.fn();
        if (options.readSequence) {
            for (const value of options.readSequence) {
                read.mockResolvedValueOnce(value);
            }
            read.mockResolvedValue(options.readSequence[options.readSequence.length - 1]);
        } else {
            read.mockResolvedValue(NOTE);
        }

        const app = {
            vault: {
                read,
                modify,
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
                    frontmatter: { 'confluence-url': `${BASE}/wiki/spaces/SP/pages/12345/My+Page` },
                }),
            },
            fileManager: {
                processFrontMatter: options.processFrontMatter ?? jest.fn().mockResolvedValue(undefined),
                getAvailablePathForAttachment: jest.fn().mockImplementation(async (n: string) => `attachments/${n}`),
                generateMarkdownLink: jest.fn().mockImplementation((f: TFile) => `![[${f.path.split('/').pop()}]]`),
                trashFile: jest.fn().mockImplementation(async (f: TFile) => {
                    created.delete(f.path);
                }),
            },
            __created: created,
            __applied: appliedContents,
        };

        (ConfluenceApiClient as unknown as jest.Mock).mockImplementation(() => ({
            getPage: jest.fn().mockResolvedValue({
                id: '12345', title: 'My Page',
                body: { storage: { value: '<p>remote body</p>', representation: 'storage' } },
                version: { number: 7, when: '' },
                space: { key: 'SP', name: 'Space' },
            }),
            getAttachmentDownloadLinks: jest.fn().mockResolvedValue(
                new Map([['diagram.png', { download: '/download/attachments/12345/diagram.png', version: 3 }]])
            ),
            downloadBinary: jest.fn().mockResolvedValue({ data: new ArrayBuffer(1024), contentType: 'image/png' }),
            getBaseUrl: () => BASE,
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
                imageRefs: options.imageRefs ?? [attachmentRef()],
            }),
        }));

        (ConflictResolutionModal as unknown as jest.Mock).mockImplementation(
            (_a: unknown, _d: unknown, onAccept: () => Promise<void>, onSettled?: () => void) => ({
                open: jest.fn().mockImplementation(() => {
                    onAccept().then(() => onSettled?.()).catch(() => onSettled?.());
                }),
                close: jest.fn(),
            })
        );

        return app;
    }

    beforeEach(() => {
        jest.clearAllMocks();
        Notice.reset();
    });

    test('version failure + untouched note: rolled back to snapshot, created attachments trashed, no success notice', async () => {
        const processFrontMatter = jest.fn().mockRejectedValue(new Error('fm write failed'));
        // read sequence: metadata read, stale1, stale2, stale3(final), recovery re-read
        // Recovery re-read must equal the APPLIED content → craft below.
        const app = setup({ processFrontMatter });
        // First 4 reads return NOTE; recovery read returns whatever modify wrote.
        (app.vault.read as jest.Mock).mockImplementation(async () => {
            const applied = app.__applied;
            // After body write, return the applied content (untouched note).
            return applied.length > 0 ? applied[applied.length - 1] : NOTE;
        });

        const service = new ConfluenceSyncService(app as never, settings, mockLogger);
        await service.syncFromConfluence(makeFile());

        // Rolled back: last modify call wrote the ORIGINAL snapshot.
        const modifyCalls = (app.vault.modify as jest.Mock).mock.calls;
        expect(modifyCalls.length).toBe(2); // apply + rollback
        expect(modifyCalls[1][1]).toBe(NOTE);
        // Created attachment trashed.
        expect(app.fileManager.trashFile).toHaveBeenCalledTimes(1);
        // No success notice.
        expect(Notice.messages.find((m: string) => m.includes('✅'))).toBeUndefined();
        // Recovery notice shown.
        expect(Notice.messages.find((m: string) => m.includes('安全回滾'))).toBeTruthy();
    });

    test('version failure + user edited after write: NO rollback, note kept, high-severity notice', async () => {
        const processFrontMatter = jest.fn().mockRejectedValue(new Error('fm write failed'));
        const app = setup({ processFrontMatter });
        let bodyWritten = false;
        (app.vault.modify as jest.Mock).mockImplementation(async () => { bodyWritten = true; });
        (app.vault.read as jest.Mock).mockImplementation(async () => {
            // After the body write, simulate an immediate user edit.
            return bodyWritten ? 'USER EDITED CONTENT AFTER APPLY' : NOTE;
        });

        const service = new ConfluenceSyncService(app as never, settings, mockLogger);
        await service.syncFromConfluence(makeFile());

        // Only ONE modify (the apply) — no rollback overwrite of the user edit.
        expect((app.vault.modify as jest.Mock).mock.calls.length).toBe(1);
        // Attachments kept (not trashed).
        expect(app.fileManager.trashFile).not.toHaveBeenCalled();
        expect(Notice.messages.find((m: string) => m.includes('未回滾'))).toBeTruthy();
        expect(Notice.messages.find((m: string) => m.includes('✅'))).toBeUndefined();
    });

    test('version failure + rollback modify fails: keep new content, notice, no crash', async () => {
        const processFrontMatter = jest.fn().mockRejectedValue(new Error('fm write failed'));
        const app = setup({ processFrontMatter });
        let applies = 0;
        (app.vault.modify as jest.Mock).mockImplementation(async (_f: unknown, content: string) => {
            applies++;
            if (applies === 2) throw new Error('rollback write failed');
            app.__applied.push(content);
        });
        (app.vault.read as jest.Mock).mockImplementation(async () => {
            return app.__applied.length > 0 ? app.__applied[app.__applied.length - 1] : NOTE;
        });

        const service = new ConfluenceSyncService(app as never, settings, mockLogger);
        await service.syncFromConfluence(makeFile());

        expect(Notice.messages.find((m: string) => m.includes('回滾也失敗'))).toBeTruthy();
        // Attachments NOT trashed (note kept new content referencing them).
        expect(app.fileManager.trashFile).not.toHaveBeenCalled();
    });

    test('version success path unchanged: single modify, success notice, no recovery notices', async () => {
        const app = setup();
        (app.vault.read as jest.Mock).mockResolvedValue(NOTE);

        const service = new ConfluenceSyncService(app as never, settings, mockLogger);
        await service.syncFromConfluence(makeFile());

        expect((app.vault.modify as jest.Mock).mock.calls.length).toBe(1);
        expect(Notice.messages.find((m: string) => m.includes('✅'))).toBeTruthy();
        expect(Notice.messages.find((m: string) => m.includes('回滾'))).toBeUndefined();
    });

    test('sync lock is released after version-failure recovery (next sync can start)', async () => {
        const processFrontMatter = jest.fn()
            .mockRejectedValueOnce(new Error('fm write failed'))
            .mockResolvedValue(undefined);
        const app = setup({ processFrontMatter });
        (app.vault.read as jest.Mock).mockImplementation(async () => {
            const applied = app.__applied;
            return applied.length > 0 ? applied[applied.length - 1] : NOTE;
        });

        const service = new ConfluenceSyncService(app as never, settings, mockLogger);
        const file = makeFile();
        await service.syncFromConfluence(file);
        Notice.reset();

        // Second sync on the same file must be allowed (lock released).
        await service.syncFromConfluence(file);
        expect(Notice.messages.find((m: string) => m.includes('already in progress'))).toBeUndefined();
    });
});
