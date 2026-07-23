import { PluginLogger, sanitizeLogData } from '../../src/utils/logger';
import { MemoryDataAdapter } from '../mocks/obsidian';

const PLUGIN_DIR = '.obsidian/plugins/confluence-import';
const LOG_PATH = `${PLUGIN_DIR}/debug.log`;

function makeLogger(overrides: Record<string, unknown> = {}) {
    const adapter = new MemoryDataAdapter();
    const settings = { enableDebugLogging: true, ...overrides } as any;
    const logger = new PluginLogger(settings, adapter as any, PLUGIN_DIR);
    return { logger, adapter, logPath: logger.getLogPath() };
}

describe('sanitizeLogData (redaction)', () => {
    test('redacts sensitive keys at any depth', () => {
        const out: any = sanitizeLogData({
            apiToken: 'secret-123',
            nested: { authorization: 'Bearer abc', userEmail: 'a@b.com' },
            password: 'hunter2',
        });
        expect(out.apiToken).toBe('[REDACTED]');
        expect(out.nested.authorization).toBe('[REDACTED]');
        expect(out.nested.userEmail).toBe('[REDACTED]');
        expect(out.password).toBe('[REDACTED]');
    });

    test('replaces content-bearing string fields with length placeholder', () => {
        const out: any = sanitizeLogData({
            content: '# Full note body that must not land in the log',
            remoteContent: 'x'.repeat(5000),
            body: 'page body',
            count: 42,
        });
        expect(out.content).toBe('[content: 46 chars]');
        expect(out.remoteContent).toBe('[content: 5000 chars]');
        expect(out.body).toBe('[content: 9 chars]');
        expect(out.count).toBe(42);
    });

    test('strips query strings and credentials from URLs', () => {
        const out = sanitizeLogData('https://user:pass@example.atlassian.net/wiki/page?jwt=secret#frag');
        expect(out).toBe('https://example.atlassian.net/wiki/page');
        expect(String(out)).not.toContain('secret');
        expect(String(out)).not.toContain('pass');
    });

    test('truncates very long non-content strings', () => {
        const out = String(sanitizeLogData('a'.repeat(500)));
        expect(out.length).toBeLessThan(260);
        expect(out).toContain('[+300 chars]');
    });

    test('serializes Error objects with bounded stack', () => {
        const out: any = sanitizeLogData(new Error('boom'));
        expect(out.message).toBe('boom');
        expect(String(out.stack).split('\n').length).toBeLessThanOrEqual(8);
    });

    test('handles circular references without throwing', () => {
        const a: any = { name: 'a' };
        a.self = a;
        const out: any = sanitizeLogData(a);
        expect(out.name).toBe('a');
        expect(out.self).toBe('[circular]');
    });

    test('contains throwing getters per-property', () => {
        const obj = {} as any;
        Object.defineProperty(obj, 'bad', { get() { throw new Error('nope'); }, enumerable: true });
        obj.good = 1;
        const out: any = sanitizeLogData(obj);
        expect(out.bad).toBe('[getter threw]');
        expect(out.good).toBe(1);
    });

    test('functions, symbols, bigints are stringified safely', () => {
        const out: any = sanitizeLogData({ f: () => 1, s: Symbol('x'), b: BigInt(9) });
        expect(out.f).toBe('[function]');
        expect(out.s).toBe('[symbol]');
        expect(out.b).toBe('9');
    });
});

describe('PluginLogger (DataAdapter, async queue, rotation, lifecycle)', () => {
    test('log path is vault-relative and normalized', () => {
        const { logPath } = makeLogger();
        expect(logPath).toBe(LOG_PATH);
        expect(logPath.startsWith('/')).toBe(false);
    });

    test('writes are ordered and flushed by flush()', async () => {
        const { logger, adapter } = makeLogger();
        logger.info('first');
        logger.info('second');
        logger.info('third');
        await logger.flush();

        const text = adapter.files.get(LOG_PATH) ?? '';
        const first = text.indexOf('first');
        const second = text.indexOf('second');
        const third = text.indexOf('third');
        expect(first).toBeGreaterThan(-1);
        expect(first).toBeLessThan(second);
        expect(second).toBeLessThan(third);
    });

    test('creates the plugin directory if missing', async () => {
        const { logger, adapter } = makeLogger();
        logger.info('hello');
        await logger.flush();
        expect(adapter.dirs.has(PLUGIN_DIR)).toBe(true);
    });

    test('data payloads are sanitized before hitting disk', async () => {
        const { logger, adapter } = makeLogger();
        logger.info('sync', {
            apiToken: 'super-secret-token',
            content: 'full note body here',
            url: 'https://h.example.com/x?token=abc',
        });
        await logger.flush();

        const text = adapter.files.get(LOG_PATH) ?? '';
        expect(text).not.toContain('super-secret-token');
        expect(text).not.toContain('full note body here');
        expect(text).not.toContain('token=abc');
        expect(text).toContain('[REDACTED]');
        expect(text).toContain('[content: 19 chars]');
    });

    test('disabled logging writes nothing', async () => {
        const { logger, adapter } = makeLogger({ enableDebugLogging: false });
        logger.info('should not appear');
        await logger.flush();
        expect(adapter.files.has(LOG_PATH)).toBe(false);
    });

    test('rotates when file exceeds the size bound, replacing older rotation', async () => {
        const { logger, adapter } = makeLogger();
        adapter.files.set(LOG_PATH, 'x'.repeat(1024 * 1024 + 10));
        adapter.files.set(LOG_PATH + '.1', 'ancient rotation');
        logger.info('after rotation');
        await logger.flush();

        expect(adapter.files.get(LOG_PATH + '.1')).toContain('x'.repeat(100));
        expect(adapter.files.get(LOG_PATH + '.1')).not.toBe('ancient rotation');
        const active = adapter.files.get(LOG_PATH) ?? '';
        expect(active).toContain('after rotation');
        expect(active.length).toBeLessThan(10_000);
    });

    test('write failure does not throw and reports console.error only once', async () => {
        const { logger, adapter } = makeLogger();
        adapter.failWrites = true;
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        logger.info('this write will fail');
        await expect(logger.flush()).resolves.toBeUndefined();
        logger.info('second failing write');
        await expect(logger.flush()).resolves.toBeUndefined();

        expect(consoleSpy).toHaveBeenCalledTimes(1);
        consoleSpy.mockRestore();
    });

    test('close() flushes pending writes and blocks later entries', async () => {
        const { logger, adapter } = makeLogger();
        logger.info('before close');
        await logger.close();

        logger.info('after close');
        await logger.flush();

        const text = adapter.files.get(LOG_PATH) ?? '';
        expect(text).toContain('before close');
        expect(text).not.toContain('after close');
    });

    test('clear() empties active log and removes rotation', async () => {
        const { logger, adapter } = makeLogger();
        logger.info('entry');
        await logger.flush();
        adapter.files.set(LOG_PATH + '.1', 'old');

        logger.clear();
        await logger.flush();

        expect(adapter.files.get(LOG_PATH)).toBe('');
        expect(adapter.files.has(LOG_PATH + '.1')).toBe(false);
    });

    test('legacy string constructor form: no I/O, single console.error, never throws', async () => {
        const settings = { enableDebugLogging: true } as any;
        const logger = new PluginLogger(settings, PLUGIN_DIR, '/legacy/vault/path');
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        logger.info('goes nowhere');
        await expect(logger.flush()).resolves.toBeUndefined();
        logger.info('still nowhere');
        await expect(logger.flush()).resolves.toBeUndefined();

        expect(consoleSpy).toHaveBeenCalledTimes(1);
        consoleSpy.mockRestore();
    });
});
