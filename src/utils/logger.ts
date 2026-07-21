import { ConfluenceSettings } from '../models';
import * as path from 'path';
import * as fs from 'fs';

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

/**
 * Recursively sanitize a data payload for logging:
 * - sensitive keys → '[REDACTED]'
 * - content keys   → '[content: N chars]'
 * - URL-looking strings → origin+path only
 * - long strings truncated
 */
export function sanitizeLogData(data: any, depth = 0): any {
    if (data === null || data === undefined) return data;
    if (depth > MAX_DEPTH) return '[max depth]';

    if (typeof data === 'string') {
        const urlSanitized = /^[a-z][a-z0-9+.-]*:\/\//i.test(data) ? sanitizeUrlLike(data) : data;
        return urlSanitized.length > MAX_STRING_LENGTH
            ? urlSanitized.substring(0, MAX_STRING_LENGTH) + `…[+${urlSanitized.length - MAX_STRING_LENGTH} chars]`
            : urlSanitized;
    }
    if (typeof data === 'number' || typeof data === 'boolean') return data;

    if (data instanceof Error) {
        return { name: data.name, message: sanitizeLogData(data.message, depth + 1), stack: data.stack?.split('\n').slice(0, 8).join('\n') };
    }

    if (Array.isArray(data)) {
        return data.slice(0, 20).map(item => sanitizeLogData(item, depth + 1));
    }

    if (typeof data === 'object') {
        const out: Record<string, any> = {};
        for (const [key, value] of Object.entries(data)) {
            if (keyMatches(key, SENSITIVE_KEY_FRAGMENTS)) {
                out[key] = '[REDACTED]';
            } else if (keyMatches(key, CONTENT_KEY_FRAGMENTS) && typeof value === 'string') {
                out[key] = `[content: ${value.length} chars]`;
            } else {
                out[key] = sanitizeLogData(value, depth + 1);
            }
        }
        return out;
    }

    return String(data);
}

/**
 * File logger with:
 * - metadata-only output (all payloads pass through sanitizeLogData)
 * - ordered async write queue (no sync I/O on the main thread after startup)
 * - size-bounded log file with single-generation rotation
 * - flush()/close() for plugin unload
 *
 * Write failures are contained: they mark the logger unhealthy and log once
 * to console.error — they never produce unhandled rejections.
 */
export class PluginLogger {
    private logFilePath: string;
    private queue: Promise<void> = Promise.resolve();
    private closed = false;
    private writeFailureReported = false;

    constructor(
        private settings: ConfluenceSettings,
        pluginManifestDir: string,
        vaultBasePath: string
    ) {
        // Construct absolute path to the log file in the plugin directory
        this.logFilePath = path.join(vaultBasePath, pluginManifestDir, 'debug.log');
    }

    info(message: string, data?: any) {
        this.log('INFO', message, data);
    }

    error(message: string, data?: any) {
        this.log('ERROR', message, data);
    }

    warn(message: string, data?: any) {
        this.log('WARN', message, data);
    }

    private log(level: string, message: string, data?: any) {
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
        // rejections from fs failures.
        this.queue = this.queue
            .then(() => this.writeWithRotation(logMessage))
            .catch((err) => {
                if (!this.writeFailureReported) {
                    this.writeFailureReported = true;
                    console.error('[Confluence Import] Failed to write to debug log', err);
                }
            });
    }

    private async writeWithRotation(text: string): Promise<void> {
        // Rotate when the active file would exceed the bound.
        try {
            const stat = await fs.promises.stat(this.logFilePath);
            if (stat.size + text.length > MAX_LOG_FILE_BYTES) {
                await fs.promises.rename(this.logFilePath, this.logFilePath + ROTATED_SUFFIX);
            }
        } catch {
            // File does not exist yet — nothing to rotate.
        }
        await fs.promises.appendFile(this.logFilePath, text);
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

    clear() {
        this.queue = this.queue
            .then(async () => {
                await fs.promises.writeFile(this.logFilePath, '');
                await fs.promises.rm(this.logFilePath + ROTATED_SUFFIX, { force: true });
            })
            .catch((e) => {
                console.error('Failed to clear log', e);
            });
    }

    getLogPath(): string {
        return this.logFilePath;
    }
}
