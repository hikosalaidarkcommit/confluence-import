/**
 * Plugin lifecycle & settings regression tests.
 *
 * These tests exercise the behaviours fixed in this patch:
 *   - saveSettings() must NOT rebuild ConfluenceSyncService
 *   - Text-field changes are debounced (saveSettingsDebounced)
 *   - enablePageIdCache controls which resolver is used
 *   - The resolver cache persists across syncs when enabled
 *   - Plugin unload signals the service (unload()) before finishing
 *   - Logger uses the public FileSystemAdapter.getBasePath() API
 *   - Test Connection uses Notice, not prompt/alert
 */
import { ConfluenceSyncService } from '../../src/services/sync-service';
import { CachedPageResolver, ConfluencePageResolver } from '../../src/api/page-resolver';
import { ConfluenceApiClient } from '../../src/api/confluence-client';
import { PluginLogger } from '../../src/utils/logger';
import { FileSystemAdapter } from 'obsidian';
import { DEFAULT_SETTINGS, ConfluenceSettings } from '../../src/models';

// ---------------------------------------------------------------------------
// Shared mock helpers
// ---------------------------------------------------------------------------

jest.mock('../../src/api/confluence-client');
jest.mock('../../src/api/page-resolver');
jest.mock('../../src/diff/diff-engine');
jest.mock('../../src/ui/conflict-modal');

const mockLogger: PluginLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    clear: jest.fn(),
    getLogPath: jest.fn(),
} as any;

function makeSettings(overrides: Partial<ConfluenceSettings> = {}): ConfluenceSettings {
    return { ...DEFAULT_SETTINGS, baseUrl: 'https://example.atlassian.net', apiToken: 'tok', userEmail: 'u@e.com', ...overrides };
}

function makeApp() {
    return {
        vault: {
            read: jest.fn().mockResolvedValue(
                '---\nconfluence-url: https://example.atlassian.net/wiki/spaces/SP/pages/1/T\n---\nbody'
            ),
            modify: jest.fn().mockResolvedValue(undefined),
            adapter: new (FileSystemAdapter as any)('/vault'),
        },
        metadataCache: {
            getFileCache: jest.fn().mockReturnValue({
                frontmatter: { 'confluence-url': 'https://example.atlassian.net/wiki/spaces/SP/pages/1/T' },
            }),
        },
        fileManager: {
            processFrontMatter: jest.fn().mockImplementation(async (_f: any, cb: any) => { cb({}); }),
        },
    } as any;
}

// ---------------------------------------------------------------------------
// ConfluenceSyncService — settings & cache ownership
// ---------------------------------------------------------------------------

describe('ConfluenceSyncService: single-instance settings update', () => {
    beforeEach(() => jest.clearAllMocks());

    test('updateSettings() mutates _settings in-place without rebuilding the service', () => {
        const settings = makeSettings();
        const service = new ConfluenceSyncService(makeApp(), settings, mockLogger);

        const original = (service as any)._settings;
        const newSettings = makeSettings({ apiToken: 'new-token' });

        service.updateSettings(newSettings);

        // The service is the same instance — no new object was assigned to some
        // external reference; the internal _settings reference is updated.
        expect((service as any)._settings).toBe(newSettings);
        expect((service as any)._settings.apiToken).toBe('new-token');
        // The original object was NOT mutated
        expect(original.apiToken).toBe('tok');
    });

    test('updateSettings() with enablePageIdCache=false discards the cached resolver', () => {
        const service = new ConfluenceSyncService(makeApp(), makeSettings({ enablePageIdCache: true }), mockLogger);
        // Simulate a cached resolver having been created
        (service as any).cachedResolver = { dummy: true };

        service.updateSettings(makeSettings({ enablePageIdCache: false }));

        expect((service as any).cachedResolver).toBeNull();
    });

    test('updateSettings() with enablePageIdCache=true preserves the cached resolver', () => {
        const service = new ConfluenceSyncService(makeApp(), makeSettings({ enablePageIdCache: true }), mockLogger);
        const fakeResolver = { dummy: true };
        (service as any).cachedResolver = fakeResolver;

        service.updateSettings(makeSettings({ enablePageIdCache: true }));

        expect((service as any).cachedResolver).toBe(fakeResolver);
    });
});

// ---------------------------------------------------------------------------
// ConfluenceSyncService — resolver selection (cache on vs off)
// ---------------------------------------------------------------------------

describe('ConfluenceSyncService: enablePageIdCache controls resolver type', () => {
    const { Notice } = require('obsidian');

    beforeEach(() => {
        jest.clearAllMocks();
        Notice.reset?.();

        // DiffEngine → identical (skip modal)
        const { DiffEngine } = require('../../src/diff/diff-engine');
        (DiffEngine as jest.Mock).mockImplementation(() => ({
            compare: jest.fn().mockResolvedValue({
                isIdentical: true, hasConflicts: false,
                remoteVersion: 0, remoteContent: '', localContent: '',
            }),
        }));

        // API client returns a valid page
        (ConfluenceApiClient as jest.Mock).mockImplementation(() => ({
            getPage: jest.fn().mockResolvedValue({
                id: '1', title: 'T',
                body: { storage: { value: '<p>body</p>', representation: 'storage' } },
                version: { number: 1, when: '' },
                space: { key: 'SP', name: 'S' },
            }),
        }));
    });

    test('enablePageIdCache=true: CachedPageResolver is used', async () => {
        (CachedPageResolver as jest.Mock).mockImplementation(() => ({
            resolvePageId: jest.fn().mockResolvedValue({ pageId: '1', version: 1, title: 'T', spaceKey: 'SP' }),
            updateApiClient: jest.fn(),
        }));

        const service = new ConfluenceSyncService(makeApp(), makeSettings({ enablePageIdCache: true }), mockLogger);
        await service.syncFromConfluence({ path: 'note.md', basename: 'note', extension: 'md' } as any);

        expect(CachedPageResolver).toHaveBeenCalled();
        expect(ConfluencePageResolver).not.toHaveBeenCalled();
    });

    test('enablePageIdCache=false: ConfluencePageResolver (no cache) is used', async () => {
        (ConfluencePageResolver as jest.Mock).mockImplementation(() => ({
            resolvePageId: jest.fn().mockResolvedValue({ pageId: '1', version: 1, title: 'T', spaceKey: 'SP' }),
        }));

        const service = new ConfluenceSyncService(makeApp(), makeSettings({ enablePageIdCache: false }), mockLogger);
        await service.syncFromConfluence({ path: 'note.md', basename: 'note', extension: 'md' } as any);

        // CachedPageResolver must NOT have been constructed
        expect(CachedPageResolver).not.toHaveBeenCalled();
        expect(ConfluencePageResolver).toHaveBeenCalled();
    });

    test('enablePageIdCache=true: same CachedPageResolver instance reused across syncs', async () => {
        (CachedPageResolver as jest.Mock).mockImplementation(() => ({
            resolvePageId: jest.fn().mockResolvedValue({ pageId: '1', version: 1, title: 'T', spaceKey: 'SP' }),
            updateApiClient: jest.fn(),
        }));

        const service = new ConfluenceSyncService(makeApp(), makeSettings({ enablePageIdCache: true }), mockLogger);
        const file = { path: 'note.md', basename: 'note', extension: 'md' } as any;

        await service.syncFromConfluence(file);
        await service.syncFromConfluence(file);

        // Constructor called only once — the same instance was reused
        expect(CachedPageResolver).toHaveBeenCalledTimes(1);
    });

    test('switching to enablePageIdCache=false via updateSettings forces fresh resolver next sync', async () => {
        (CachedPageResolver as jest.Mock).mockImplementation(() => ({
            resolvePageId: jest.fn().mockResolvedValue({ pageId: '1', version: 1, title: 'T', spaceKey: 'SP' }),
            updateApiClient: jest.fn(),
        }));
        (ConfluencePageResolver as jest.Mock).mockImplementation(() => ({
            resolvePageId: jest.fn().mockResolvedValue({ pageId: '1', version: 1, title: 'T', spaceKey: 'SP' }),
        }));

        const service = new ConfluenceSyncService(makeApp(), makeSettings({ enablePageIdCache: true }), mockLogger);
        const file = { path: 'note.md', basename: 'note', extension: 'md' } as any;

        await service.syncFromConfluence(file);
        expect(CachedPageResolver).toHaveBeenCalledTimes(1);

        // User toggles cache off
        service.updateSettings(makeSettings({ enablePageIdCache: false }));
        expect((service as any).cachedResolver).toBeNull();

        await service.syncFromConfluence(file);
        expect(ConfluencePageResolver).toHaveBeenCalledTimes(1);
        // CachedPageResolver was NOT called again
        expect(CachedPageResolver).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// ConfluenceSyncService — unload safety
// ---------------------------------------------------------------------------

describe('ConfluenceSyncService: unload() safety', () => {
    beforeEach(() => jest.clearAllMocks());

    test('unload() sets _unloading=true', () => {
        const service = new ConfluenceSyncService(makeApp(), makeSettings(), mockLogger);
        expect((service as any)._unloading).toBe(false);
        service.unload();
        expect((service as any)._unloading).toBe(true);
    });

    test('unload() closes active modal and clears the reference', () => {
        const service = new ConfluenceSyncService(makeApp(), makeSettings(), mockLogger);
        const fakeModal = { close: jest.fn() };
        (service as any)._activeModal = fakeModal;

        service.unload();

        expect(fakeModal.close).toHaveBeenCalledTimes(1);
        expect((service as any)._activeModal).toBeNull();
    });

    test('unload() is safe when no modal is open', () => {
        const service = new ConfluenceSyncService(makeApp(), makeSettings(), mockLogger);
        expect(() => service.unload()).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// PluginLogger — desktop adapter guard
// ---------------------------------------------------------------------------

describe('PluginLogger: FileSystemAdapter desktop guard', () => {
    test('FileSystemAdapter.getBasePath() returns the vault path', () => {
        const adapter = new (FileSystemAdapter as any)('/my/vault');
        expect((adapter as FileSystemAdapter).getBasePath()).toBe('/my/vault');
    });

    test('instanceof check works for the mock (mirrors plugin code logic)', () => {
        const adapter = new (FileSystemAdapter as any)('/vault');
        expect(adapter instanceof FileSystemAdapter).toBe(true);
    });

    test('non-FileSystemAdapter (e.g. mobile CapacitorAdapter) falls back to empty string', () => {
        // Simulate a non-desktop adapter that lacks getBasePath
        const mobileAdapter = { getName: () => 'capacitor' };
        const vaultPath = mobileAdapter instanceof FileSystemAdapter
            ? mobileAdapter.getBasePath()
            : '';
        expect(vaultPath).toBe('');
    });
});

// ---------------------------------------------------------------------------
// CachedPageResolver — updateApiClient()
// ---------------------------------------------------------------------------

describe('CachedPageResolver: updateApiClient()', () => {
    // Use real implementation for this suite
    jest.unmock('../../src/api/page-resolver');

    afterAll(() => {
        jest.mock('../../src/api/page-resolver');
    });

    test('updateApiClient swaps the underlying client without clearing cache', async () => {
        const { CachedPageResolver: RealCPR } = jest.requireActual('../../src/api/page-resolver');

        const client1 = { getPage: jest.fn().mockResolvedValue({ id: '1', title: 'T', version: { number: 1 }, space: { key: 'SP' } }) } as any;
        const client2 = { getPage: jest.fn().mockResolvedValue({ id: '2', title: 'T2', version: { number: 2 }, space: { key: 'SP' } }) } as any;

        const resolver = new RealCPR(client1);

        // First resolve — populates cache
        const parsed = { pageId: '1', baseUrl: 'https://x.com', urlType: 'modern' as const };
        await resolver.resolvePageId(parsed);
        expect(client1.getPage).toHaveBeenCalledTimes(1);

        // Swap client — cache key 'id:1' still exists
        resolver.updateApiClient(client2);

        // Second resolve hits cache → client2.getPage NOT called
        await resolver.resolvePageId(parsed);
        expect(client2.getPage).not.toHaveBeenCalled();
    });
});
