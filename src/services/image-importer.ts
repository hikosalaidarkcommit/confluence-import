import { App, TFile, normalizePath } from 'obsidian';
import { RemoteImageRef, ImageOutcome } from '../models';
import { ConfluenceApiClient, ConfluenceApiError } from '../api/confluence-client';
import { deterministicHash } from '../diff/diff-engine';
import { PluginLogger } from '../utils/logger';
import { resolveDownloadUrl } from '../utils/url-utils';

/** Per-image size cap: 20 MiB. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** Max image refs processed per page. */
export const MAX_IMAGES_PER_PAGE = 50;
/** Total bytes cap per import: 100 MiB. */
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

/** Marker used to identify images pull-imported by this plugin. */
export const IMPORT_MARKER_PREFIX = 'confluence-import-image:';

/** Build the deterministic identity string for an image ref. */
export function buildImageIdentity(
    pageId: string,
    ref: RemoteImageRef,
    meta?: { download: string; version: number },
    baseUrl?: string
): string | null {
    if (ref.kind === 'attachment' && ref.filename && meta) {
        return meta.version
            ? `attachment:${pageId}:${meta.download}:${meta.version}`
            : `attachment:${pageId}:${meta.download}`;
    }
    if (ref.kind === 'url' && ref.url && baseUrl) {
        const resolved = resolveDownloadUrl(baseUrl, ref.url);
        return `url:${resolved || ref.url}`;
    }
    return null;
}

/** Build the HTML comment marker for a given identity. */
export function buildImageMarker(identity: string): string {
    const hash = deterministicHash(identity).slice(0, 16);
    return `<!-- ${IMPORT_MARKER_PREFIX}${hash} -->`;
}

/** MIME allowlist → canonical file extension. SVG is deliberately excluded
 * (scriptable content); HTML/unknown types are rejected. */
const MIME_EXTENSIONS: ReadonlyMap<string, string> = new Map([
    ['image/png', 'png'],
    ['image/jpeg', 'jpg'],
    ['image/gif', 'gif'],
    ['image/webp', 'webp'],
    ['image/bmp', 'bmp'],
]);

/** Fixed failure reasons (machine-readable; never raw response bodies). */
export type ImageFailureReason =
    | 'metadata-missing'
    | 'origin-mismatch'
    | 'http-error'
    | 'mime-rejected'
    | 'too-large'
    | 'total-budget-exceeded'
    | 'count-limit-exceeded'
    | 'write-failed';

const REASON_TEXT: Record<ImageFailureReason, string> = {
    'metadata-missing': '在頁面附件中找不到對應的附件中繼資料',
    'origin-mismatch': '下載網址與設定的 Confluence 網域不符',
    'http-error': '下載失敗(HTTP 錯誤)',
    'mime-rejected': '不支援的圖片格式(僅允許 PNG/JPEG/GIF/WebP/BMP)',
    'too-large': '圖片超過單檔 20MB 上限',
    'total-budget-exceeded': '已達本次匯入 100MB 總量上限',
    'count-limit-exceeded': '已達單頁 50 張圖片上限',
    'write-failed': '寫入附件檔案失敗',
};

/**
 * Escape a URL for safe display inside Markdown text/callouts:
 * angle-bracket form neutralizes parentheses/spaces; backticks and
 * angle brackets in the URL itself are percent-encoded.
 */
export function escapeUrlForMarkdown(url: string): string {
    return url.replace(/[<>`\\]/g, (c) => encodeURIComponent(c));
}

/**
 * Build the visible failure/kept-remote block: remote image embed plus a
 * warning callout containing the remote URL, per approved UX (正文照常更新,
 * 失敗圖片保留遠端 URL + 缺圖提示).
 */
export function buildFailureBlock(
    ref: RemoteImageRef,
    remoteUrl: string,
    reason: ImageFailureReason
): string {
    const safeUrl = escapeUrlForMarkdown(remoteUrl);
    const alt = ref.alt || 'image';
    return [
        `![${alt}](${safeUrl})`,
        '',
        `> [!warning] 圖片未匯入`,
        `> 遠端 URL: <${safeUrl}>`,
        `> 原因:${REASON_TEXT[reason]}`,
    ].join('\n');
}

/** Kept-remote (external source) block: remote embed + safety notice. */
export function buildExternalRemoteBlock(ref: RemoteImageRef, remoteUrl: string): string {
    const safeUrl = escapeUrlForMarkdown(remoteUrl);
    const alt = ref.alt || 'image';
    return [
        `![${alt}](${safeUrl})`,
        '',
        `> [!info] 外部圖片未匯入`,
        `> 此圖片來自外部網站,為安全考量不會下載或傳送憑證,仍以遠端連結顯示。`,
        `> 遠端 URL: <${safeUrl}>`,
    ].join('\n');
}

/**
 * Deterministic plugin-owned attachment filename:
 * `confluence-<pageId>-<hash12>.<ext>` — no untrusted path components.
 * Repeat pulls of the same page+source produce the same name, enabling
 * safe reuse detection (the prefix marks the file as plugin-owned).
 */
export function buildAttachmentFilename(pageId: string, sourceIdentity: string, extension: string): string {
    const safePageId = pageId.replace(/[^0-9a-zA-Z]/g, '').slice(0, 20) || 'page';
    return `confluence-${safePageId}-${deterministicHash(sourceIdentity).slice(0, 12)}.${extension}`;
}

/** Extract the base MIME type from a Content-Type header value. */
export function extensionForMime(contentType: string): string | null {
    const mime = contentType.split(';')[0].trim().toLowerCase();
    return MIME_EXTENSIONS.get(mime) ?? null;
}

export interface ImageImportSummary {
    outcomes: ImageOutcome[];
    imported: number;
    reused: number;
    failed: number;
    keptRemote: number;
    /** Paths of files created in THIS attempt (rollback set). */
    createdPaths: string[];
}

/**
 * Downloads Confluence attachment images and prepares token replacements.
 *
 * Security contract:
 * - Only same-configured-origin attachment URLs (from API `_links.download`
 *   metadata) are downloaded, with auth. If metadata cannot map a source,
 *   that image FAILS with a remote callout — download URLs are never guessed.
 * - External `ri:url` / external `img src` are never fetched and never see
 *   credentials; they stay as remote links with a safety notice.
 * - Downloads are sequential; per-image/total/count limits enforced.
 */
export class ImageImporter {
    constructor(
        private app: App,
        private apiClient: ConfluenceApiClient,
        private logger: PluginLogger
    ) { }

    /**
     * Phase 1 (before second stale check): download all eligible images into
     * memory buffers. No vault writes happen here.
     */
    async downloadAll(
        pageId: string,
        refs: RemoteImageRef[],
        notePath: string,
        resolvedLinks?: Map<string, { download: string; version: number }>
    ): Promise<ImageImportSummary> {
        const outcomes: ImageOutcome[] = [];
        const summary: ImageImportSummary = {
            outcomes, imported: 0, reused: 0, failed: 0, keptRemote: 0, createdPaths: [],
        };

        let attachmentLinks = resolvedLinks ?? null;
        let totalBytes = 0;
        const baseUrl = this.apiClient.getBaseUrl();

        for (let i = 0; i < refs.length; i++) {
            const ref = refs[i];

            // Count limit applies to processed refs.
            if (i >= MAX_IMAGES_PER_PAGE) {
                outcomes.push(this.fail(ref, this.remoteUrlFor(ref, baseUrl), 'count-limit-exceeded', summary));
                continue;
            }

            if (ref.kind === 'url') {
                const url = ref.url ?? '';
                const sameOrigin = resolveDownloadUrl(baseUrl, url);
                if (!sameOrigin) {
                    // External source: kept remote by design, never fetched.
                    outcomes.push({
                        ref,
                        status: 'kept-remote',
                        replacement: buildExternalRemoteBlock(ref, url),
                    });
                    summary.keptRemote++;
                    continue;
                }
                // Same-origin explicit URL: treat like an authenticated download.
                const outcome = await this.downloadOne(ref, sameOrigin, pageId, `url:${url}`, notePath, totalBytes);
                if (outcome.status === 'imported' && outcome.bufferBytes) totalBytes += outcome.bufferBytes;
                outcomes.push(outcome.outcome);
                this.tally(outcome.outcome, summary);
                continue;
            }

            // kind === 'attachment' — needs API metadata resolution.
            if (attachmentLinks === null) {
                try {
                    const neededFilenames = new Set(
                        refs.filter(r => r.kind === 'attachment' && r.filename).map(r => r.filename!)
                    );
                    attachmentLinks = await this.apiClient.getAttachmentDownloadLinks(pageId, neededFilenames);
                } catch (e) {
                    this.logger.warn('Attachment metadata fetch failed', {
                        status: e instanceof ConfluenceApiError ? e.status : undefined,
                    });
                    attachmentLinks = new Map();
                }
            }
            const meta = ref.filename ? attachmentLinks.get(ref.filename) : undefined;
            if (!meta) {
                outcomes.push(this.fail(ref, this.remoteUrlFor(ref, baseUrl), 'metadata-missing', summary));
                continue;
            }
            const absolute = resolveDownloadUrl(baseUrl, meta.download);
            if (!absolute) {
                outcomes.push(this.fail(ref, this.remoteUrlFor(ref, baseUrl), 'origin-mismatch', summary));
                continue;
            }
            const identity = meta.version
                ? `attachment:${pageId}:${meta.download}:${meta.version}`
                : `attachment:${pageId}:${meta.download}`;
            const outcome = await this.downloadOne(
                ref, absolute, pageId, identity, notePath, totalBytes
            );
            if (outcome.status === 'imported' && outcome.bufferBytes) totalBytes += outcome.bufferBytes;
            outcomes.push(outcome.outcome);
            this.tally(outcome.outcome, summary);
        }

        return summary;
    }

    /**
     * Phase 2 (after second stale check passed): write buffered images via
     * vault.createBinary and finalize replacements with proper markdown
     * links. Files created here are recorded for rollback.
     */
    async writeBuffers(summary: ImageImportSummary, notePath: string): Promise<void> {
        for (const outcome of summary.outcomes) {
            const pending = this.pendingBuffers.get(outcome.ref.token);
            if (!pending || outcome.status !== 'imported') continue;

            try {
                const file = await this.app.vault.createBinary(pending.path, pending.data);
                outcome.createdPath = file.path;
                summary.createdPaths.push(file.path);
                outcome.replacement = this.buildLocalEmbed(file, notePath, outcome.ref, pending.identity);
            } catch (e) {
                this.logger.warn('Attachment write failed', {
                    reason: e instanceof Error ? e.name : 'unknown',
                });
                outcome.status = 'failed';
                outcome.reason = 'write-failed';
                outcome.replacement = buildFailureBlock(
                    outcome.ref, pending.remoteUrl, 'write-failed'
                );
                summary.imported--;
                summary.failed++;
            }
        }
        this.pendingBuffers.clear();
    }

    /**
     * Roll back files created in this attempt (stale/unload/write failure):
     * only paths recorded in createdPaths are trashed — reused files are
     * never touched.
     */
    async rollback(summary: ImageImportSummary): Promise<void> {
        for (const path of summary.createdPaths) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file) {
                try {
                    await this.app.fileManager.trashFile(file);
                } catch {
                    this.logger.warn('Rollback trash failed', { path });
                }
            }
        }
        summary.createdPaths.length = 0;
    }

    /** Apply outcome replacements to the markdown by exact token match. */
    static applyReplacements(markdown: string, outcomes: ImageOutcome[]): string {
        let result = markdown;
        for (const outcome of outcomes) {
            // split/join replaces ALL occurrences of the exact token without
            // regex interpretation of any characters.
            result = result.split(outcome.ref.token).join(outcome.replacement);
        }
        return result;
    }

    // ---------------------------------------------------------------- private

    private pendingBuffers = new Map<string, { path: string; data: ArrayBuffer; remoteUrl: string; identity: string }>();

    private tally(outcome: ImageOutcome, summary: ImageImportSummary): void {
        if (outcome.status === 'imported') summary.imported++;
        else if (outcome.status === 'reused') summary.reused++;
        else if (outcome.status === 'failed') summary.failed++;
        else summary.keptRemote++;
    }

    private fail(
        ref: RemoteImageRef,
        remoteUrl: string,
        reason: ImageFailureReason,
        summary: ImageImportSummary
    ): ImageOutcome {
        summary.failed++;
        return {
            ref,
            status: 'failed',
            reason,
            replacement: buildFailureBlock(ref, remoteUrl, reason),
        };
    }

    /** Best remote URL to show for a ref in failure callouts. */
    private remoteUrlFor(ref: RemoteImageRef, baseUrl: string): string {
        if (ref.kind === 'url' && ref.url) return ref.url;
        // Attachment without resolvable download link: page attachments view
        // is a stable, human-usable remote location.
        return `${baseUrl}/pages/viewpageattachments.action?pageId=`;
    }

    private buildLocalEmbed(file: TFile, notePath: string, ref: RemoteImageRef, identity: string): string {
        const link = this.app.fileManager.generateMarkdownLink(file, notePath);
        // generateMarkdownLink returns a non-embed link for binaries in some
        // configs; ensure embed syntax.
        const embed = link.startsWith('!') ? link : `!${link}`;
        let finalized = embed;
        if (ref.width) {
            // Obsidian wiki-embed size syntax: ![[file.png|300]]
            if (embed.startsWith('![[') && embed.endsWith(']]')) {
                finalized = `${embed.slice(0, -2)}|${ref.width}]]`;
            }
        }
        return `${finalized} ${buildImageMarker(identity)}`;
    }

    private async downloadOne(
        ref: RemoteImageRef,
        absoluteUrl: string,
        pageId: string,
        identity: string,
        notePath: string,
        totalSoFar: number
    ): Promise<{ outcome: ImageOutcome; status: string; bufferBytes?: number }> {
        // Budget check before the request.
        if (totalSoFar >= MAX_TOTAL_BYTES) {
            const outcome: ImageOutcome = {
                ref, status: 'failed', reason: 'total-budget-exceeded',
                replacement: buildFailureBlock(ref, absoluteUrl, 'total-budget-exceeded'),
            };
            return { outcome, status: 'failed' };
        }

        let data: ArrayBuffer;
        let contentType: string;
        try {
            const result = await this.apiClient.downloadBinary(absoluteUrl);
            data = result.data;
            contentType = result.contentType;
        } catch (e) {
            const reason: ImageFailureReason =
                e instanceof ConfluenceApiError && e.statusText === 'Blocked download'
                    ? 'origin-mismatch' : 'http-error';
            const outcome: ImageOutcome = {
                ref, status: 'failed', reason,
                replacement: buildFailureBlock(ref, absoluteUrl, reason),
            };
            return { outcome, status: 'failed' };
        }

        const extension = extensionForMime(contentType);
        if (!extension) {
            const outcome: ImageOutcome = {
                ref, status: 'failed', reason: 'mime-rejected',
                replacement: buildFailureBlock(ref, absoluteUrl, 'mime-rejected'),
            };
            return { outcome, status: 'failed' };
        }
        if (data.byteLength > MAX_IMAGE_BYTES) {
            const outcome: ImageOutcome = {
                ref, status: 'failed', reason: 'too-large',
                replacement: buildFailureBlock(ref, absoluteUrl, 'too-large'),
            };
            return { outcome, status: 'failed' };
        }
        if (totalSoFar + data.byteLength > MAX_TOTAL_BYTES) {
            const outcome: ImageOutcome = {
                ref, status: 'failed', reason: 'total-budget-exceeded',
                replacement: buildFailureBlock(ref, absoluteUrl, 'total-budget-exceeded'),
            };
            return { outcome, status: 'failed' };
        }

        const filename = buildAttachmentFilename(pageId, identity, extension);

        // Reuse: if a plugin-owned file with the deterministic name already
        // exists anywhere under the attachment path resolution, reuse it.
        // Existence is recognized ONLY via the plugin's own deterministic
        // prefix+hash name — unrelated files can never collide because the
        // name embeds the content-source hash and the `confluence-` prefix.
        const availablePath = normalizePath(
            await this.app.fileManager.getAvailablePathForAttachment(filename, notePath)
        );
        const reusablePath = this.findExistingDeterministicFile(availablePath, filename);
        if (reusablePath) {
            const existing = this.app.vault.getAbstractFileByPath(reusablePath);
            if (existing instanceof TFile) {
                const outcome: ImageOutcome = {
                    ref, status: 'reused',
                    replacement: this.buildLocalEmbed(existing, notePath, ref, identity),
                };
                return { outcome, status: 'reused' };
            }
        }

        // Buffer for phase 2 (write happens only after the second stale check).
        this.pendingBuffers.set(ref.token, { path: availablePath, data, remoteUrl: absoluteUrl, identity });
        const outcome: ImageOutcome = {
            ref, status: 'imported',
            // Temporary; finalized in writeBuffers() with the real link.
            replacement: `![${ref.alt || 'image'}](${escapeUrlForMarkdown(absoluteUrl)})`,
        };
        return { outcome, status: 'imported', bufferBytes: data.byteLength };
    }

    /**
     * getAvailablePathForAttachment appends " 1", " 2", … when the target
     * exists. If the returned path differs from `<dir>/<filename>` AND the
     * plain `<dir>/<filename>` exists, that existing file IS our
     * deterministic plugin-owned file from a previous pull — reuse it.
     */
    private findExistingDeterministicFile(availablePath: string, filename: string): string | null {
        if (availablePath.endsWith('/' + filename) || availablePath === filename) {
            return null; // No collision — the deterministic name is free.
        }
        const dir = availablePath.substring(0, availablePath.lastIndexOf('/'));
        const canonical = dir ? `${dir}/${filename}` : filename;
        const existing = this.app.vault.getAbstractFileByPath(canonical);
        return existing ? canonical : null;
    }
}
