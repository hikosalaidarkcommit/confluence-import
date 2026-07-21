import { ConfluenceSyncService } from '../../src/services/sync-service';
import { DiffEngine } from '../../src/diff/diff-engine';
import { ConfluenceApiClient, ConfluenceApiError } from '../../src/api/confluence-client';
import { CachedPageResolver } from '../../src/api/page-resolver';
import { ConflictResolutionModal } from '../../src/ui/conflict-modal';
import { DiffResult } from '../../src/models';

// Mock only the ConfluenceApiClient constructor while preserving ConfluenceApiError
// as the real class. This allows instanceof checks in handleError to work correctly
// when tests inject real ConfluenceApiError instances into mock rejections.
jest.mock('../../src/api/confluence-client', () => {
    const actual = jest.requireActual('../../src/api/confluence-client');
    return {
        ...actual,
        ConfluenceApiClient: jest.fn(),
    };
});
jest.mock('../../src/api/page-resolver');
jest.mock('../../src/diff/diff-engine');
jest.mock('../../src/ui/conflict-modal');

const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
} as any;

const settings = {
    baseUrl: 'https://example.atlassian.net',
    apiToken: 'token',
    userEmail: 'user@example.com',
    enableDebugLogging: false,
    enablePageIdCache: true,
} as any;

const REMOTE_PAGE = {
    id: '12345',
    title: 'My Page',
    body: { storage: { value: '<p>remote body</p>', representation: 'storage' } },
    version: { number: 7, when: '2026-01-01' },
    space: { key: 'SP', name: 'Space' },
};

// Every remote-write style method a Confluence client could expose.
// Sync must NEVER call any of these.
const REMOTE_WRITE_METHODS = ['updatePage', 'uploadAttachment', 'createPage', 'deletePage'];

function makeFile(path = 'note.md') {
    return { path, basename: 'note', extension: 'md' } as any;
}

function makeApp(overrides: any = {}) {
    return {
        vault: {
            read: jest.fn().mockResolvedValue(
                '---\nconfluence-url: https://example.atlassian.net/wiki/spaces/SP/pages/12345/My+Page\n---\nlocal body'
            ),
            modify: jest.fn().mockResolvedValue(undefined),
            adapter: { basePath: '/vault', readBinary: jest.fn() },
        },
        metadataCache: {
            getFileCache: jest.fn().mockReturnValue({
                frontmatter: {
                    'confluence-url':
                        'https://example.atlassian.net/wiki/spaces/SP/pages/12345/My+Page',
                },
            }),
        },
        fileManager: {
            processFrontMatter: jest.fn().mockImplementation(async (_file, cb) => {
                const fm: any = {};
                cb(fm);
                return fm;
            }),
        },
        ...overrides,
    } as any;
}

function apiInstance(): any {
    return (ConfluenceApiClient as jest.Mock).mock.results[0]?.value;
}

function expectNoRemoteWrites() {
    const api = apiInstance();
    if (!api) return; // client never even constructed — trivially no writes
    for (const method of REMOTE_WRITE_METHODS) {
        if (api[method]) {
            expect(api[method]).not.toHaveBeenCalled();
        }
    }
}

type ModalBehavior =
    | { kind: 'accept' }                         // user clicks Pull & Replace, apply succeeds
    | { kind: 'cancel' }                         // user cancels immediately
    | { kind: 'acceptThenCancelOnError' }        // accept fires but apply throws → user cancels
    | { kind: 'hang' };                          // modal stays open (manual release)

let releaseModal: (() => void) | null = null;

function setupMocks(diffResult: Partial<DiffResult>, modal: ModalBehavior = { kind: 'cancel' }) {
    releaseModal = null;

    (ConfluenceApiClient as jest.Mock).mockImplementation(() => {
        const client: any = {
            getPage: jest.fn().mockResolvedValue(REMOTE_PAGE),
        };
        for (const method of REMOTE_WRITE_METHODS) {
            client[method] = jest.fn().mockRejectedValue(
                new Error(`${method} must never be called by pull-only sync`)
            );
        }
        return client;
    });

    (CachedPageResolver as jest.Mock).mockImplementation(() => ({
        resolvePageId: jest
            .fn()
            .mockResolvedValue({ pageId: '12345', version: 7, title: 'My Page', spaceKey: 'SP' }),
        updateApiClient: jest.fn(),
    }));

    (DiffEngine as jest.Mock).mockImplementation(() => ({
        compare: jest.fn().mockResolvedValue({
            hasConflicts: true,
            isIdentical: false,
            remoteVersion: 0,
            remoteContent: 'remote body',
            localContent: 'local body',
            ...diffResult,
        }),
    }));

    // Simulates the real modal lifecycle.
    // ConflictResolutionModal now receives onAccept() (no content param).
    // onSettled fires when the modal closes (accepted or cancelled).
    (ConflictResolutionModal as jest.Mock).mockImplementation(
        (
            _app: any,
            _diff: any,
            onAccept: () => Promise<void>,
            onSettled?: () => void
        ) => ({
            open: jest.fn().mockImplementation(() => {
                if (modal.kind === 'accept') {
                    onAccept()
                        .then(() => onSettled?.())
                        .catch(() => onSettled?.());
                } else if (modal.kind === 'acceptThenCancelOnError') {
                    onAccept()
                        .then(() => onSettled?.())
                        .catch(() => onSettled?.());
                } else if (modal.kind === 'cancel') {
                    onSettled?.();
                } else {
                    // hang: user keeps the modal open until released
                    releaseModal = () => onSettled?.();
                }
            }),
            close: jest.fn().mockImplementation(() => onSettled?.()),
        })
    );
}

describe('ConfluenceSyncService.syncFromConfluence (one-way pull)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('successful pull with differences: fetches, diffs, writes raw remoteContent to local file only', async () => {
        setupMocks({}, { kind: 'accept' });
        const app = makeApp();
        const service = new ConfluenceSyncService(app, settings, mockLogger);

        await service.syncFromConfluence(makeFile());

        expect(apiInstance().getPage).toHaveBeenCalledWith('12345');

        const diffInstance = (DiffEngine as jest.Mock).mock.results[0].value;
        expect(diffInstance.compare).toHaveBeenCalledWith('local body', '<p>remote body</p>');

        expect(app.vault.modify).toHaveBeenCalledTimes(1);
        const written = app.vault.modify.mock.calls[0][1];
        // The written content must preserve frontmatter and use the RAW remoteContent —
        // never a merged/partial result.
        expect(written).toContain('confluence-url:');
        expect(written).toContain('remote body');

        // Local confluence-version set to the FETCHED remote version (7)
        expect(app.fileManager.processFrontMatter).toHaveBeenCalledTimes(1);
        const fm: any = {};
        app.fileManager.processFrontMatter.mock.calls[0][1](fm);
        expect(fm['confluence-version']).toBe(7);

        expectNoRemoteWrites();
    });

    test('identical content (isIdentical=true): no body write, version aligned, no modal, no remote writes', async () => {
        setupMocks({
            isIdentical: true,
            hasConflicts: false,
        });
        const app = makeApp();
        const service = new ConfluenceSyncService(app, settings, mockLogger);

        await service.syncFromConfluence(makeFile());

        expect(app.vault.modify).not.toHaveBeenCalled();
        expect(ConflictResolutionModal).not.toHaveBeenCalled();

        expect(app.fileManager.processFrontMatter).toHaveBeenCalledTimes(1);
        const fm: any = {};
        app.fileManager.processFrontMatter.mock.calls[0][1](fm);
        expect(fm['confluence-version']).toBe(7);

        expectNoRemoteWrites();
    });

    test('user cancels resolution: local file untouched, no remote writes', async () => {
        setupMocks({}, { kind: 'cancel' });
        const app = makeApp();
        const service = new ConfluenceSyncService(app, settings, mockLogger);

        await service.syncFromConfluence(makeFile());

        expect(ConflictResolutionModal).toHaveBeenCalledTimes(1);
        expect(app.vault.modify).not.toHaveBeenCalled();
        expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
        expectNoRemoteWrites();
    });

    test('H4: concurrent sync on the SAME file is rejected for the whole modal lifecycle', async () => {
        setupMocks({}, { kind: 'hang' });
        const app = makeApp();
        const service = new ConfluenceSyncService(app, settings, mockLogger);
        const file = makeFile('same.md');

        const first = service.syncFromConfluence(file);
        // Give the first sync time to reach the (hanging) modal
        await new Promise((r) => setTimeout(r, 10));
        expect(ConflictResolutionModal).toHaveBeenCalledTimes(1);

        // Second trigger while the modal is still open → rejected, no new client/modal
        await service.syncFromConfluence(file);
        expect((ConfluenceApiClient as jest.Mock).mock.calls.length).toBe(1);
        expect(ConflictResolutionModal).toHaveBeenCalledTimes(1);
        expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.stringContaining('already in progress')
        );

        // Release the modal; first sync finishes and the guard clears
        releaseModal?.();
        await first;

        // A new sync on the same file is allowed again (it will hang on its
        // own modal, so start it, verify a second client was constructed,
        // then release it).
        const third = service.syncFromConfluence(file);
        await new Promise((r) => setTimeout(r, 10));
        expect((ConfluenceApiClient as jest.Mock).mock.calls.length).toBe(2);
        releaseModal?.();
        await third;
    });

    test('H4: syncs on DIFFERENT files run independently', async () => {
        setupMocks({}, { kind: 'cancel' });
        const app = makeApp();
        const service = new ConfluenceSyncService(app, settings, mockLogger);

        await Promise.all([
            service.syncFromConfluence(makeFile('a.md')),
            service.syncFromConfluence(makeFile('b.md')),
        ]);

        // Both syncs proceeded (two clients constructed, no rejection warning)
        expect((ConfluenceApiClient as jest.Mock).mock.calls.length).toBe(2);
        expect(mockLogger.warn).not.toHaveBeenCalledWith(
            expect.stringContaining('already in progress')
        );
    });

    test('H3: rogue confluence-url host is blocked BEFORE any client is constructed', async () => {
        setupMocks({});
        const app = makeApp({
            metadataCache: {
                getFileCache: jest.fn().mockReturnValue({
                    frontmatter: {
                        'confluence-url':
                            'https://evil-attacker.example.com/wiki/spaces/SP/pages/12345/Trap',
                    },
                }),
            },
        });
        const service = new ConfluenceSyncService(app, settings, mockLogger);

        await service.syncFromConfluence(makeFile());

        expect(ConfluenceApiClient).not.toHaveBeenCalled();
        expect(mockLogger.error).toHaveBeenCalled();
        expect(app.vault.modify).not.toHaveBeenCalled();
    });

    test('H3: sync aborts when no base URL is configured (no host to validate against)', async () => {
        setupMocks({});
        const app = makeApp();
        const service = new ConfluenceSyncService(
            app,
            { ...settings, baseUrl: '' },
            mockLogger
        );

        await service.syncFromConfluence(makeFile());

        expect(ConfluenceApiClient).not.toHaveBeenCalled();
        expect(mockLogger.error).toHaveBeenCalled();
    });

    test('H3: same host is allowed (config with trailing slash and different path)', async () => {
        setupMocks({ isIdentical: true, hasConflicts: false });
        const app = makeApp();
        const service = new ConfluenceSyncService(
            app,
            { ...settings, baseUrl: 'https://example.atlassian.net/' },
            mockLogger
        );

        await service.syncFromConfluence(makeFile());

        expect(ConfluenceApiClient).toHaveBeenCalledTimes(1);
        expect(mockLogger.error).not.toHaveBeenCalled();
    });

    test('M1: local apply failure propagates to the modal (rethrown) and version marker is not advanced', async () => {
        setupMocks({}, { kind: 'acceptThenCancelOnError' });
        const app = makeApp();
        app.vault.modify.mockRejectedValue(new Error('disk full'));
        const service = new ConfluenceSyncService(app, settings, mockLogger);

        // Capture what the service's onAccept callback does with the failure
        let callbackRejected = false;
        (ConflictResolutionModal as jest.Mock).mockImplementation(
            (
                _app: any,
                _diff: any,
                onAccept: () => Promise<void>,
                onSettled?: () => void
            ) => ({
                open: jest.fn().mockImplementation(() => {
                    onAccept()
                        .then(() => onSettled?.())
                        .catch(() => {
                            callbackRejected = true; // real modal keeps itself open here
                            onSettled?.();           // then user cancels
                        });
                }),
                close: jest.fn().mockImplementation(() => onSettled?.()),
            })
        );

        await service.syncFromConfluence(makeFile());

        // The rejection MUST reach the modal so its keep-open/retry logic works
        expect(callbackRejected).toBe(true);
        expect(mockLogger.error).toHaveBeenCalled();
        expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
        expectNoRemoteWrites();
    });

    test('fetch failure: error handled, local file untouched', async () => {
        setupMocks({});
        (ConfluenceApiClient as jest.Mock).mockImplementation(() => ({
            getPage: jest.fn().mockRejectedValue(new Error('network down')),
        }));
        const app = makeApp();
        const service = new ConfluenceSyncService(app, settings, mockLogger);

        await expect(service.syncFromConfluence(makeFile())).resolves.toBeUndefined();

        expect(mockLogger.error).toHaveBeenCalled();
        expect(app.vault.modify).not.toHaveBeenCalled();
        expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
    });

    test('failed sync releases the in-flight guard (retry allowed)', async () => {
        setupMocks({});
        (ConfluenceApiClient as jest.Mock).mockImplementation(() => ({
            getPage: jest.fn().mockRejectedValue(new Error('boom')),
        }));
        const app = makeApp();
        const service = new ConfluenceSyncService(app, settings, mockLogger);
        const file = makeFile();

        await service.syncFromConfluence(file);
        await service.syncFromConfluence(file);

        // Both attempts went through (guard released after failure)
        expect((ConfluenceApiClient as jest.Mock).mock.calls.length).toBe(2);
    });

    test('missing confluence-url frontmatter: aborts before any network client is created', async () => {
        setupMocks({});
        const app = makeApp({
            metadataCache: {
                getFileCache: jest.fn().mockReturnValue({ frontmatter: {} }),
            },
        });
        const service = new ConfluenceSyncService(app, settings, mockLogger);

        await expect(service.syncFromConfluence(makeFile())).resolves.toBeUndefined();

        expect(mockLogger.error).toHaveBeenCalled();
        expect(ConfluenceApiClient).not.toHaveBeenCalled();
        expect(app.vault.modify).not.toHaveBeenCalled();
    });

    test('missing credentials: aborts before contacting Confluence', async () => {
        setupMocks({});
        const app = makeApp();
        const service = new ConfluenceSyncService(
            app,
            { ...settings, apiToken: '' },
            mockLogger
        );

        await service.syncFromConfluence(makeFile());

        expect(ConfluenceApiClient).not.toHaveBeenCalled();
        expect(mockLogger.error).toHaveBeenCalled();
    });

    test('service exposes no push/upload API surface', () => {
        const service: any = new ConfluenceSyncService(makeApp(), settings, mockLogger);
        expect(service.pushToConfluence).toBeUndefined();
        expect(service.uploadContent).toBeUndefined();
        expect(service.syncWithConfluence).toBeUndefined();
        expect(typeof service.syncFromConfluence).toBe('function');
    });

    describe('large-page guardrail', () => {
        // moduleNameMapper maps 'obsidian' to our hand-written mock,
        // whose Notice records messages statically.
        const { Notice } = require('obsidian');

        function pageOfSize(bytes: number) {
            return {
                ...REMOTE_PAGE,
                body: { storage: { value: 'x'.repeat(bytes), representation: 'storage' } },
            };
        }

        function noticeMessages(): string[] {
            return Notice.messages;
        }

        beforeEach(() => {
            Notice.reset();
        });

        test('>1MB page shows a single large-page warning and sync continues', async () => {
            setupMocks({ isIdentical: true, hasConflicts: false });
            (ConfluenceApiClient as jest.Mock).mockImplementation(() => ({
                getPage: jest.fn().mockResolvedValue(
                    pageOfSize(ConfluenceSyncService.LARGE_PAGE_WARNING_BYTES + 1)
                ),
            }));
            const app = makeApp();
            const service = new ConfluenceSyncService(app, settings, mockLogger);

            await service.syncFromConfluence(makeFile());

            const warnings = noticeMessages().filter((m) => m.includes('large'));
            expect(warnings).toHaveLength(1);
            // Sync continued to completion (identical path → version aligned)
            expect(app.fileManager.processFrontMatter).toHaveBeenCalledTimes(1);
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Large remote page',
                expect.objectContaining({ storageSize: expect.any(Number) })
            );
        });

        test('page at/below threshold shows no large-page warning', async () => {
            setupMocks({ isIdentical: true, hasConflicts: false });
            (ConfluenceApiClient as jest.Mock).mockImplementation(() => ({
                getPage: jest.fn().mockResolvedValue(
                    pageOfSize(ConfluenceSyncService.LARGE_PAGE_WARNING_BYTES)
                ),
            }));
            const app = makeApp();
            const service = new ConfluenceSyncService(app, settings, mockLogger);

            await service.syncFromConfluence(makeFile());

            const warnings = noticeMessages().filter((m) => m.includes('large'));
            expect(warnings).toHaveLength(0);
            expect(app.fileManager.processFrontMatter).toHaveBeenCalledTimes(1);
        });
    });

    // ────────────────────────────────────────────────────────────────────────
    // Regression: apply-time stale-file detection
    // ────────────────────────────────────────────────────────────────────────
    describe('stale-file detection at apply time', () => {
        const { Notice } = require('obsidian');

        beforeEach(() => {
            Notice.reset();
        });

        test('stale body: external edit to body during modal aborts apply, preserves user content, keeps modal open for retry', async () => {
            setupMocks({}, { kind: 'accept' });

            // First vault.read (before modal) returns original; second read
            // (inside apply callback) returns externally-edited content.
            const original =
                '---\nconfluence-url: https://example.atlassian.net/wiki/spaces/SP/pages/12345/My+Page\n---\nlocal body';
            const externalEdit =
                '---\nconfluence-url: https://example.atlassian.net/wiki/spaces/SP/pages/12345/My+Page\n---\nexternally edited body';

            const app = makeApp({
                vault: {
                    read: jest.fn()
                        .mockResolvedValueOnce(original)   // initial read
                        .mockResolvedValueOnce(externalEdit), // re-read at apply
                    modify: jest.fn().mockResolvedValue(undefined),
                    adapter: { basePath: '/vault', readBinary: jest.fn() },
                },
            });

            const service = new ConfluenceSyncService(app, settings, mockLogger);
            await service.syncFromConfluence(makeFile());

            // Must NOT write to disk
            expect(app.vault.modify).not.toHaveBeenCalled();
            expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();

            // Must show a clear warning notice
            const abortNotices = Notice.messages.filter((m: string) => m.includes('modified while'));
            expect(abortNotices.length).toBeGreaterThanOrEqual(1);

            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Apply aborted'),
                expect.objectContaining({ path: expect.any(String) })
            );
        });

        test('stale frontmatter: external frontmatter-only edit during modal aborts apply', async () => {
            setupMocks({}, { kind: 'accept' });

            const original =
                '---\nconfluence-url: https://example.atlassian.net/wiki/spaces/SP/pages/12345/My+Page\ntags: []\n---\nlocal body';
            const externalEdit =
                '---\nconfluence-url: https://example.atlassian.net/wiki/spaces/SP/pages/12345/My+Page\ntags: [important]\n---\nlocal body';

            const app = makeApp({
                vault: {
                    read: jest.fn()
                        .mockResolvedValueOnce(original)
                        .mockResolvedValueOnce(externalEdit),
                    modify: jest.fn().mockResolvedValue(undefined),
                    adapter: { basePath: '/vault', readBinary: jest.fn() },
                },
            });

            const service = new ConfluenceSyncService(app, settings, mockLogger);
            await service.syncFromConfluence(makeFile());

            expect(app.vault.modify).not.toHaveBeenCalled();
            expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
        });

        test('no external edit: apply succeeds, writes raw remoteContent, preserves existing frontmatter properties', async () => {
            setupMocks({}, { kind: 'accept' });

            // File with additional frontmatter properties beyond confluence-url
            const content =
                '---\nconfluence-url: https://example.atlassian.net/wiki/spaces/SP/pages/12345/My+Page\ntags: [important]\nauthor: alice\n---\nlocal body';

            const app = makeApp({
                vault: {
                    read: jest.fn().mockResolvedValue(content),
                    modify: jest.fn().mockResolvedValue(undefined),
                    adapter: { basePath: '/vault', readBinary: jest.fn() },
                },
                metadataCache: {
                    getFileCache: jest.fn().mockReturnValue({
                        frontmatter: {
                            'confluence-url':
                                'https://example.atlassian.net/wiki/spaces/SP/pages/12345/My+Page',
                        },
                    }),
                },
            });

            const service = new ConfluenceSyncService(app, settings, mockLogger);
            await service.syncFromConfluence(makeFile());

            expect(app.vault.modify).toHaveBeenCalledTimes(1);
            const written: string = app.vault.modify.mock.calls[0][1];

            // Extra frontmatter properties preserved
            expect(written).toContain('tags: [important]');
            expect(written).toContain('author: alice');
            // Body is the raw remoteContent from DiffEngine ('remote body'),
            // NOT a merged/partial string.
            expect(written).toContain('remote body');
        });

        test('apply writes the EXACT remote body — trailing newline preserved, no merge artifacts', async () => {
            // Remote content ends with a trailing newline (typical Turndown output)
            const remoteWithNewline = 'Remote line one\n\nRemote line two\n';
            setupMocks({ remoteContent: remoteWithNewline }, { kind: 'accept' });
            const app = makeApp();
            const service = new ConfluenceSyncService(app, settings, mockLogger);

            await service.syncFromConfluence(makeFile());

            expect(app.vault.modify).toHaveBeenCalledTimes(1);
            const written: string = app.vault.modify.mock.calls[0][1];

            // Body after the frontmatter block must be byte-identical to
            // remoteContent (frontmatter + '\n' + remoteContent).
            const fmEnd = written.indexOf('---', 3) + 3; // end of closing ---
            const body = written.slice(fmEnd + 1); // skip the joining '\n'
            expect(body).toBe(remoteWithNewline);
            // No local content leaks into the written body
            expect(body).not.toContain('local body');
        });

        test('cancel leaves body, frontmatter, and version ALL untouched (zero writes)', async () => {
            setupMocks({}, { kind: 'cancel' });
            const app = makeApp();
            const service = new ConfluenceSyncService(app, settings, mockLogger);

            await service.syncFromConfluence(makeFile());

            expect(app.vault.modify).not.toHaveBeenCalled();
            expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
            expectNoRemoteWrites();
        });

        test('remote empty body: apply aborted, note untouched, notice shown, modal stays open', async () => {
            const { Notice } = require('obsidian');
            Notice.reset();

            setupMocks({ remoteContent: '   \n  ' }, { kind: 'accept' });
            const app = makeApp();
            const service = new ConfluenceSyncService(app, settings, mockLogger);
            await service.syncFromConfluence(makeFile());

            // Note must NOT be touched
            expect(app.vault.modify).not.toHaveBeenCalled();
            expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();

            // A clear warning notice must be shown
            const emptyNotices = Notice.messages.filter((m: string) =>
                m.includes('empty') || m.includes('Empty')
            );
            expect(emptyNotices.length).toBeGreaterThanOrEqual(1);

            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('empty'),
                expect.objectContaining({ path: expect.any(String) })
            );
        });
    });

    // ────────────────────────────────────────────────────────────────────────
    // Regression: scheme downgrade prevention
    // ────────────────────────────────────────────────────────────────────────
    describe('scheme downgrade prevention', () => {
        test('https configured, http in note: blocked before any client is constructed', async () => {
            setupMocks({});
            const app = makeApp({
                metadataCache: {
                    getFileCache: jest.fn().mockReturnValue({
                        frontmatter: {
                            // Same host, but http instead of https
                            'confluence-url':
                                'http://example.atlassian.net/wiki/spaces/SP/pages/12345/My+Page',
                        },
                    }),
                },
            });
            const service = new ConfluenceSyncService(
                app,
                { ...settings, baseUrl: 'https://example.atlassian.net' },
                mockLogger
            );

            await service.syncFromConfluence(makeFile());

            expect(ConfluenceApiClient).not.toHaveBeenCalled();
            expect(app.vault.modify).not.toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalled();
        });

        test('same host and same protocol: allowed', async () => {
            setupMocks({ isIdentical: true, hasConflicts: false });
            const app = makeApp();
            const service = new ConfluenceSyncService(
                app,
                { ...settings, baseUrl: 'https://example.atlassian.net' },
                mockLogger
            );

            await service.syncFromConfluence(makeFile());

            expect(ConfluenceApiClient).toHaveBeenCalledTimes(1);
            expect(mockLogger.error).not.toHaveBeenCalled();
        });
    });

    // ────────────────────────────────────────────────────────────────────────
    // Regression: HTTP status codes — no local write on error
    // ────────────────────────────────────────────────────────────────────────
    describe('API status code handling', () => {
        const { Notice } = require('obsidian');

        beforeEach(() => {
            Notice.reset();
        });

        function apiError(status: number, body = '') {
            return new ConfluenceApiError(status, 'err', body);
        }

        async function syncWithGetPageError(status: number) {
            setupMocks({});
            (ConfluenceApiClient as jest.Mock).mockImplementation(() => ({
                getPage: jest.fn().mockRejectedValue(apiError(status)),
            }));
            const app = makeApp();
            const service = new ConfluenceSyncService(app, settings, mockLogger);
            await service.syncFromConfluence(makeFile());
            return app;
        }

        test('401 Unauthorized: specific notice shown, local file untouched', async () => {
            const app = await syncWithGetPageError(401);
            expect(app.vault.modify).not.toHaveBeenCalled();
            const notice401 = Notice.messages.find((m: string) => m.includes('Authentication failed'));
            expect(notice401).toBeTruthy();
        });

        test('403 Forbidden: specific notice shown, local file untouched', async () => {
            const app = await syncWithGetPageError(403);
            expect(app.vault.modify).not.toHaveBeenCalled();
            const notice403 = Notice.messages.find((m: string) => m.includes('Access denied'));
            expect(notice403).toBeTruthy();
        });

        test('404 Not Found: specific notice shown, local file untouched', async () => {
            const app = await syncWithGetPageError(404);
            expect(app.vault.modify).not.toHaveBeenCalled();
            const notice404 = Notice.messages.find((m: string) => m.includes('Page not found'));
            expect(notice404).toBeTruthy();
        });

        test('429 Rate Limit: specific notice shown, local file untouched', async () => {
            const app = await syncWithGetPageError(429);
            expect(app.vault.modify).not.toHaveBeenCalled();
            const notice429 = Notice.messages.find((m: string) => m.includes('rate limit'));
            expect(notice429).toBeTruthy();
        });

        test('invalid response shape (status 0): notice shown, local file untouched', async () => {
            setupMocks({});
            (ConfluenceApiClient as jest.Mock).mockImplementation(() => ({
                getPage: jest.fn().mockRejectedValue(
                    apiError(0, 'The Confluence API returned an unexpected response shape.')
                ),
            }));
            const app = makeApp();
            const service = new ConfluenceSyncService(app, settings, mockLogger);
            await service.syncFromConfluence(makeFile());

            expect(app.vault.modify).not.toHaveBeenCalled();
            const shapeNotice = Notice.messages.find((m: string) =>
                m.includes('Sync error') || m.includes('unexpected')
            );
            expect(shapeNotice).toBeTruthy();
        });

        test('network error: notice shown, local file untouched', async () => {
            setupMocks({});
            (ConfluenceApiClient as jest.Mock).mockImplementation(() => ({
                getPage: jest.fn().mockRejectedValue(new Error('fetch failed')),
            }));
            const app = makeApp();
            const service = new ConfluenceSyncService(app, settings, mockLogger);
            await service.syncFromConfluence(makeFile());

            expect(app.vault.modify).not.toHaveBeenCalled();
            const errNotice = Notice.messages.find((m: string) => m.includes('Error'));
            expect(errNotice).toBeTruthy();
        });
    });
});

// ConfluenceApiClient unit tests are in confluence-client.test.ts
// (kept separate to avoid conflict with the jest.mock at the top of this file).
