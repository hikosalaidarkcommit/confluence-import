import { DataAdapter, normalizePath } from 'obsidian';
import { ConfluenceSettings } from '../models';

/**
 * Keys whose values must NEVER be written to the log file, regardless of
 * where they appear in a data payload. Matched case-insensitively as
 * substrings of the key name.
 */
const SENSITIVE_KEY_FRAGMENTS = [
    'token', 'password', 'secret', 'authorization', 'auth', 'apikey',
    'api_key', 'credential', 'email', 'cookie',
];

/**
 * Keys that carry document/page CONTENT. Content is user data and must not
 * be persisted to the debug log — only its length is recorded.
 */
const CONTENT_KEY_FRAGMENTS = [
    'content', 'body', 'markdown', 'html', 'storage', 'text', 'preview',
];

const MAX_STRING_LENGTH = 200;      // hard cap for any logged string value
const MAX_DEPTH = 4;                // recursion guard for nested payloads
const MAX_ARRAY_ITEMS = 20;         // cap array expansion
const MAX_LOG_FILE_BYTES = 1024 * 1024;      // 1MB active log bound
const ROTATED_SUFFIX = '.1';                  // single rotated generation

function keyMatches(key: string, fragments: string[]): boolean {
    const k = key.toLowerCase();
    return fragments.some(f => k.includes(f));
}

/** Strip credentials and query strings (which may carry secrets) from URLs. */
function sanitizeUrlLike(value: string): string {
    try {
        const url = new URL(value);
        // Drop userinfo, query, and hash — keep origin + path only.
        return `${url.origin}${url.pathname}`;
    } catch {
        return value;
    }
}

function isPlainObjectLike(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/**
 * Recursively sanitize a data payload for logging:
 * - sensitive keys → '[REDACTED]'
 * - content keys   → '[content: N chars]'
 * - URL-looking strings → origin+path only
 * - long strings truncated
 * - cycles/depth/array size bounded
 *
 * Fully typed on `unknown`: property access only happens after narrowing,
 * and getter exceptions are contained per-property.
 */
export function sanitizeLogData(data: unknown, depth = 0, seen?: WeakSet<object>): unknown {
    if (data === null || data === undefined) return data;
    if (depth > MAX_DEPTH) return '[max depth]';

    if (typeof data === 'string') {
        const urlSanitized = /^[a-z][a-z0-9+.-]*:\/\//i.test(data) ? sanitizeUrlLike(data) : data;
        return urlSanitized.length > MAX_STRING_LENGTH
            ? urlSanitized.substring(0, MAX_STRING_LENGTH) + `…[+${urlSanitized.length - MAX_STRING_LENGTH} chars]`
            : urlSanitized;
    }
    if (typeof data === 'number' || typeof data === 'boolean') return data;
    if (typeof data === 'bigint') return data.toString();
    if (typeof data === 'function' || typeof data === 'symbol') return `[${typeof data}]`;

    if (data instanceof Error) {
        const stack: string | undefined = typeof data.stack === 'string'
            ? data.stack.split('\n').slice(0, 8).join('\n')
            : undefined;
        return {
            name: data.name,
            message: sanitizeLogData(data.message, depth + 1),
            stack,
        };
    }

    // Cycle guard for objects/arrays.
    const tracker = seen ?? new WeakSet<object>();
    if (isPlainObjectLike(data)) {
        if (tracker.has(data)) return '[circular]';
        tracker.add(data);
    }

    if (Array.isArray(data)) {
        return data.slice(0, MAX_ARRAY_ITEMS).map(item => sanitizeLogData(item, depth + 1, tracker));
    }

    if (isPlainObjectLike(data)) {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(data)) {
            let value: unknown;
            try {
                value = data[key];
            } catch {
                out[key] = '[getter threw]';
                continue;
            }
            if (keyMatches(key, SENSITIVE_KEY_FRAGMENTS)) {
                out[key] = '[REDACTED]';
            } else if (keyMatches(key, CONTENT_KEY_FRAGMENTS) && typeof value === 'string') {
                out[key] = `[content: ${value.length} chars]`;
            } else {
                out[key] = sanitizeLogData(value, depth + 1, tracker);
            }
        }
        return out;
    }

    return String(data as never);
}

/**
 * Debug logger backed by Obsidian's public {@link DataAdapter} — no Node
 * `fs`/`path` and no absolute filesystem paths. All I/O stays inside the
 * vault (the plugin's own config directory).
 *
 * Features:
 * - metadata-only output (all payloads pass through sanitizeLogData)
 * - ordered async write queue (each write chains onto the previous one)
 * - size-bounded log file with single-generation rotation (debug.log → .1)
 * - flush()/close() for plugin unload
 *
 * Write failures are contained: they log once to console.error and never
 * produce unhandled rejections.
 *
 * Integration contract (task43): construct as
 *   `new PluginLogger(settings, app.vault.adapter, `${app.vault.configDir}/plugins/${manifest.id}`)`
 * — `manifest.dir` may be used for the directory when populated. The path is
 * vault-relative; no FileSystemAdapter instanceof check or base path needed,
 * which also makes the logger mobile-safe by construction.
 */
export class PluginLogger {
    private readonly logFilePath: string;
    private readonly logDir: string;
    private queue: Promise<void> = Promise.resolve();
    private closed = false;
    private writeFailureReported = false;
    private dirEnsured = false;

    /**
     * `new PluginLogger(settings, adapter, pluginDir)`
     * with a vault-relative plugin directory.
     */
    constructor(
        private settings: ConfluenceSettings,
        private readonly adapter: DataAdapter,
        pluginDir: string
    ) {
        this.logDir = normalizePath(pluginDir);
        this.logFilePath = normalizePath(`${this.logDir}/debug.log`);
    }

    info(message: string, data?: unknown): void {
        this.log('INFO', message, data);
    }

    error(message: string, data?: unknown): void {
        this.log('ERROR', message, data);
    }

    warn(message: string, data?: unknown): void {
        this.log('WARN', message, data);
    }

    private log(level: string, message: string, data?: unknown): void {
        if (!this.settings.enableDebugLogging || this.closed) return;

        const timestamp = new Date().toISOString();
        let logMessage = `[${timestamp}] [${level}] ${message}`;
        if (data !== undefined && data !== null) {
            try {
                const sanitized = sanitizeLogData(data);
                logMessage += `\nData: ${JSON.stringify(sanitized, null, 2)}`;
            } catch {
                logMessage += `\nData: [Non-Stringifiable Object]`;
            }
        }
        logMessage += '\n----------------------------------------\n';

        // Ordered async queue: each write chains onto the previous one.
        // The catch handler keeps the chain alive and prevents unhandled
        // rejections from adapter failures.
        this.queue = this.queue
            .then(() => this.writeWithRotation(logMessage))
            .catch((err: unknown) => {
                if (!this.writeFailureReported) {
                    this.writeFailureReported = true;
                    console.error('[Confluence Page Import] Failed to write to debug log', err);
                }
            });
    }

    private requireAdapter(): DataAdapter {
        return this.adapter;
    }

    private async ensureDir(): Promise<void> {
        if (this.dirEnsured) return;
        const adapter = this.requireAdapter();
        const exists = await adapter.exists(this.logDir);
        if (!exists) {
            await adapter.mkdir(this.logDir);
        }
        this.dirEnsured = true;
    }

    private async writeWithRotation(text: string): Promise<void> {
        const adapter = this.requireAdapter();
        await this.ensureDir();
        // Rotate when the active file would exceed the bound. stat() returns
        // null when the file does not exist yet — nothing to rotate then.
        const stat = await adapter.stat(this.logFilePath);
        if (stat && stat.size + text.length > MAX_LOG_FILE_BYTES) {
            const rotated = this.logFilePath + ROTATED_SUFFIX;
            if (await adapter.exists(rotated)) {
                await adapter.remove(rotated);
            }
            await adapter.rename(this.logFilePath, rotated);
        }
        await adapter.append(this.logFilePath, text);
    }

    /** Wait for all queued writes to land on disk. */
    async flush(): Promise<void> {
        await this.queue;
    }

    /** Flush pending writes and stop accepting new entries (plugin unload). */
    async close(): Promise<void> {
        this.closed = true;
        await this.queue;
    }

    clear(): void {
        this.queue = this.queue
            .then(async () => {
                await this.ensureDir();
                await this.adapter.write(this.logFilePath, '');
                const rotated = this.logFilePath + ROTATED_SUFFIX;
                if (await this.adapter.exists(rotated)) {
                    await this.adapter.remove(rotated);
                }
            })
            .catch((e: unknown) => {
                console.error('Failed to clear log', e);
            });
    }

    /** Vault-relative path of the active log file. */
    getLogPath(): string {
        return this.logFilePath;
    }
}
