import { PluginLogger, sanitizeLogData } from '../../src/utils/logger';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function makeLogger(overrides: any = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'confsync-logger-'));
    const settings = { enableDebugLogging: true, ...overrides } as any;
    const logger = new PluginLogger(settings, '.', dir);
    return { logger, dir, logPath: logger.getLogPath() };
}

describe('sanitizeLogData (redaction)', () => {
    test('redacts sensitive keys at any depth', () => {
        const out = sanitizeLogData({
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
        const out = sanitizeLogData({
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
        expect(out).not.toContain('secret');
        expect(out).not.toContain('pass');
    });

    test('truncates very long non-content strings', () => {
        const out = sanitizeLogData('a'.repeat(500));
        expect(out.length).toBeLessThan(260);
        expect(out).toContain('[+300 chars]');
    });

    test('serializes Error objects with bounded stack', () => {
        const out = sanitizeLogData(new Error('boom'));
        expect(out.message).toBe('boom');
        expect(out.stack.split('\n').length).toBeLessThanOrEqual(8);
    });
});

describe('PluginLogger (async queue, rotation, lifecycle)', () => {
    test('writes are ordered and flushed by flush()', async () => {
        const { logger, logPath } = makeLogger();
        logger.info('first');
        logger.info('second');
        logger.info('third');
        await logger.flush();

        const text = fs.readFileSync(logPath, 'utf8');
        const first = text.indexOf('first');
        const second = text.indexOf('second');
        const third = text.indexOf('third');
        expect(first).toBeGreaterThan(-1);
        expect(first).toBeLessThan(second);
        expect(second).toBeLessThan(third);
    });

    test('data payloads are sanitized before hitting disk', async () => {
        const { logger, logPath } = makeLogger();
        logger.info('sync', {
            apiToken: 'super-secret-token',
            content: 'full note body here',
            url: 'https://h.example.com/x?token=abc',
        });
        await logger.flush();

        const text = fs.readFileSync(logPath, 'utf8');
        expect(text).not.toContain('super-secret-token');
        expect(text).not.toContain('full note body here');
        expect(text).not.toContain('token=abc');
        expect(text).toContain('[REDACTED]');
        expect(text).toContain('[content: 19 chars]');
    });

    test('disabled logging writes nothing', async () => {
        const { logger, logPath } = makeLogger({ enableDebugLogging: false });
        logger.info('should not appear');
        await logger.flush();
        expect(fs.existsSync(logPath)).toBe(false);
    });

    test('rotates when file exceeds the size bound', async () => {
        const { logger, logPath } = makeLogger();
        // Pre-seed an oversized active log file (just over 1MB)
        fs.writeFileSync(logPath, 'x'.repeat(1024 * 1024 + 10));
        logger.info('after rotation');
        await logger.flush();

        expect(fs.existsSync(logPath + '.1')).toBe(true);
        const active = fs.readFileSync(logPath, 'utf8');
        expect(active).toContain('after rotation');
        expect(active.length).toBeLessThan(10_000);
    });

    test('write failure does not throw or produce unhandled rejection', async () => {
        const settings = { enableDebugLogging: true } as any;
        // Point at an impossible path (a directory that cannot exist as a file parent)
        const logger = new PluginLogger(settings, 'no/such/dir/anywhere', '/nonexistent-root-dir');
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

        logger.info('this write will fail');
        await expect(logger.flush()).resolves.toBeUndefined();
        // Second failure must not re-report (single report flag)
        logger.info('second failing write');
        await expect(logger.flush()).resolves.toBeUndefined();

        expect(consoleSpy).toHaveBeenCalledTimes(1);
        consoleSpy.mockRestore();
    });

    test('close() flushes pending writes and blocks later entries', async () => {
        const { logger, logPath } = makeLogger();
        logger.info('before close');
        await logger.close();

        logger.info('after close');
        await logger.flush();

        const text = fs.readFileSync(logPath, 'utf8');
        expect(text).toContain('before close');
        expect(text).not.toContain('after close');
    });
});
