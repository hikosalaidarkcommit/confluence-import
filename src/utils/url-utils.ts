/**
 * URL resolution helpers shared by the image import pipeline.
 *
 * Security contract: a download URL is only usable when it resolves to the
 * SAME origin as the configured Confluence base URL. Cross-origin results,
 * non-http(s) schemes, and embedded userinfo are all rejected with null so
 * callers fail closed (image kept remote instead of fetched).
 */

/**
 * Resolve a possibly-relative download link against the configured base;
 * returns null if the result leaves the configured origin. Server/DC
 * context paths (e.g. https://host/wiki) are preserved by standard URL
 * resolution semantics — `_links.download` values that start with `/` are
 * root-absolute and already include the context path.
 */
export function resolveDownloadUrl(baseUrl: string, downloadLink: string): string | null {
    try {
        const base = new URL(baseUrl);
        const resolved = new URL(downloadLink, base);
        if (resolved.origin !== base.origin) return null;
        if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
        if (resolved.username || resolved.password) return null;
        return resolved.toString();
    } catch {
        return null;
    }
}
