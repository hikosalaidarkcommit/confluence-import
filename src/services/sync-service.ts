import { App, TFile, Notice } from 'obsidian';
import { ConfluenceSettings, DiffResult } from '../models';
import { ConfluenceUrlParser } from '../api/url-parser';
import { ConfluenceApiClient, ConfluenceApiError } from '../api/confluence-client';
import { CachedPageResolver, ConfluencePageResolver } from '../api/page-resolver';
import { DiffEngine } from '../diff/diff-engine';
import { ConflictResolutionModal } from '../ui/conflict-modal';
import { ImageImporter, ImageImportSummary, escapeUrlForMarkdown } from './image-importer';

import { PluginLogger } from '../utils/logger';

export class ConfluenceSyncService {
    /** Remote storage size above which a one-time "large page" Notice is shown. */
    static readonly LARGE_PAGE_WARNING_BYTES = 1024 * 1024; // 1MB

    private _settings: ConfluenceSettings;
    private app: App;
    private logger: PluginLogger;
    // Files with a sync currently in flight (fetch → modal → apply).
    // Prevents concurrent same-file syncs from interleaving writes.
    private syncsInFlight: Set<string> = new Set();
    // Cache resolver is owned by the service for its full lifetime so that
    // the page-ID cache persists across syncs. A fresh resolver (no cache)
    // is used when enablePageIdCache is false.
    private cachedResolver: CachedPageResolver | null = null;
    // Set to true by the plugin's onunload() to block any in-flight apply.
    private _unloading = false;
    // Track the currently open modal so onunload() can close it.
    private _activeModal: ConflictResolutionModal | null = null;

    constructor(app: App, settings: ConfluenceSettings, logger: PluginLogger) {
        this.app = app;
        this._settings = settings;
        this.logger = logger;
    }

    // Getter for settings to ensure we use latest
    private get settings(): ConfluenceSettings {
        return this._settings;
    }

    /**
     * Called by the plugin's saveSettings() to update settings in-place so
     * the existing SyncService instance (and its cache) are preserved.
     */
    updateSettings(settings: ConfluenceSettings): void {
        this._settings = settings;
        // If cache is disabled, discard the existing cached resolver so the
        // next sync picks up a fresh one according to the new setting.
        if (!settings.enablePageIdCache) {
            this.cachedResolver = null;
        }
    }

    /**
     * Called by the plugin's onunload() to shut down in-flight operations
     * gracefully: close any open modal and prevent any pending apply callback
     * from writing to disk after the plugin has been unloaded.
     */
    unload(): void {
        this._unloading = true;
        if (this._activeModal) {
            this._activeModal.close();
            this._activeModal = null;
        }
    }

    /**
     * Manually sync a note FROM Confluence (user-triggered, one-way pull):
     * fetch remote → diff → resolve locally → update ONLY the local file
     * and its `confluence-version` frontmatter. Confluence is never modified.
     */
    async syncFromConfluence(file: TFile): Promise<void> {
        if (this.syncsInFlight.has(file.path)) {
            this.logger.warn(`Sync already in progress for ${file.path}; ignoring duplicate trigger`);
            new Notice('⏳ A sync for this note is already in progress.');
            return;
        }
        this.syncsInFlight.add(file.path);
        try {
            await this.runPullSync(file);
        } finally {
            this.syncsInFlight.delete(file.path);
        }
    }

    private async runPullSync(file: TFile): Promise<void> {
        this.logger.info(`Starting pull sync for file: ${file.path}`);
        try {
            // Step 1: Validate prerequisites
            this.validateSettings();
            const metadata = await this.getConfluenceMetadata(file);
            this.logger.info('Metadata retrieved', metadata);

            // Step 2: Parse URL
            const parser = new ConfluenceUrlParser();
            const parsed = parser.parse(metadata.confluenceUrl!);
            this.logger.info('Parsed URL', parsed);

            // SECURITY: the URL comes from note frontmatter. Never send
            // credentials to a host other than the configured base URL.
            this.assertAllowedHost(parsed.baseUrl);

            const apiClient = new ConfluenceApiClient({
                baseUrl: parsed.baseUrl,
                email: this.settings.userEmail,
                apiToken: this.settings.apiToken
            });

            new Notice('🔍 Resolving Confluence page...');

            // Resolver lifecycle:
            // - When cache is enabled: reuse the long-lived CachedPageResolver
            //   so the page-ID cache persists across syncs for this service
            //   instance (which is kept alive for the plugin's full lifetime).
            // - When cache is disabled: create a fresh resolver each time so
            //   the page ID is always fetched from the API.
            let resolver: ConfluencePageResolver;
            if (this.settings.enablePageIdCache) {
                if (!this.cachedResolver) {
                    this.cachedResolver = new CachedPageResolver(apiClient);
                } else {
                    // Reuse the existing cache but swap in the latest API
                    // client (credentials may have changed via updateSettings).
                    this.cachedResolver.updateApiClient(apiClient);
                }
                resolver = this.cachedResolver;
            } else {
                resolver = new ConfluencePageResolver(apiClient);
            }
            const pageInfo = await resolver.resolvePageId(parsed);
            this.logger.info('Page resolved', pageInfo);

            if (pageInfo.warning) {
                new Notice(`⚠ ${pageInfo.warning}`, 5000);
                this.logger.warn(pageInfo.warning);
            }

            // Step 3: Fetch remote content
            new Notice('📥 Fetching remote page content...');
            const remotePage = await apiClient.getPage(pageInfo.pageId);
            this.logger.info('Remote page fetched', { version: remotePage.version.number, title: remotePage.title });

            // Large-page guardrail: warn once per sync, but never block.
            const storageSize = remotePage.body.storage.value.length;
            if (storageSize > ConfluenceSyncService.LARGE_PAGE_WARNING_BYTES) {
                const sizeMb = (storageSize / (1024 * 1024)).toFixed(1);
                new Notice(
                    `⚠ This Confluence page is large (${sizeMb} MB). ` +
                    'Sync will continue but may take a while and use extra memory.',
                    8000
                );
                this.logger.warn('Large remote page', { storageSize });
            }

            // Step 4: Get local content
            const localMarkdown = await this.app.vault.read(file);
            const { content: localBody } = this.extractFrontmatter(localMarkdown);

            // Step 5: Resolve attachment metadata (GET only) before diff
            let attachmentLinks: Map<string, { download: string; version: number }> | undefined;
            const diffEngine = new DiffEngine(this.logger);

            if (this.settings.importImages) {
                try {
                    // Extract needed filenames from remote storage to fetch only relevant metadata pages.
                    const dummyImageRefs = diffEngine.extractImageRefs(remotePage.body.storage.value);
                    const neededFilenames = new Set(
                        dummyImageRefs.filter(ref => ref.kind === 'attachment' && ref.filename).map(ref => ref.filename!)
                    );

                    attachmentLinks = await apiClient.getAttachmentDownloadLinks(pageInfo.pageId, neededFilenames);
                } catch (e) {
                    this.logger.warn('Attachment metadata fetch failed', {
                        status: e instanceof ConfluenceApiError ? e.status : undefined,
                    });
                }
            }

            // Step 6: Perform diff with version-aware image identity
            new Notice('🔄 Checking for conflicts...');
            const diffResult = await diffEngine.compare(
                localBody,
                remotePage.body.storage.value,
                pageInfo.pageId,
                attachmentLinks,
                apiClient.getBaseUrl()
            );
            diffResult.remoteVersion = remotePage.version.number;
            this.logger.info('Diff result', {
                hasConflicts: diffResult.hasConflicts,
                localLength: diffResult.localContent.length,
                remoteLength: diffResult.remoteContent.length
            });

            // Step 7: Handle identical content, differences, or finish
            if (diffResult.isIdentical) {
                // Real no-op path: never touch the note body.
                this.logger.info('Content identical');
                new Notice('✓ Content is identical to Confluence.');
                // Keep the local version marker aligned with the remote page
                await this.updateVersionInFrontmatter(file, remotePage.version.number);
            } else {
                this.logger.info('Showing pull preview (pull only)');
                // Snapshot the file state BEFORE the modal opens so we can
                // detect external edits made while the user was reviewing.
                const snapshotContent = localMarkdown;

                // Show the diff preview modal and WAIT for it to finish
                // (accepted or cancelled). On accept the ENTIRE remoteContent
                // replaces the local body — there is no per-block resolution.
                // Confluence is never written to.
                await this.showPullPreview(diffResult, async () => {
                    let imageSummary: ImageImportSummary | null = null;
                    const imageImporter = new ImageImporter(this.app, apiClient, this.logger);
                    try {
                        this.logger.info('Pull accepted. Verifying file state before apply.');

                        // Reject the apply if the plugin was unloaded while
                        // the modal was open (e.g. user disabled the plugin).
                        if (this._unloading) {
                            throw new Error('Plugin unloaded — apply cancelled.');
                        }

                        // Guard: refuse to write an empty remote body. An empty
                        // Confluence page most likely indicates a conversion
                        // failure, not a real empty page intent.
                        if (!diffResult.remoteContent.trim()) {
                            const msg =
                                '⚠ The Confluence page appears empty after conversion. ' +
                                'Pull aborted to protect your note. Check the page on Confluence.';
                            new Notice(msg, 10000);
                            this.logger.warn('Apply aborted: remote content is empty', {
                                path: file.path,
                            });
                            throw new Error(msg);
                        }

                        // FIRST stale check: re-read the current file state to
                        // detect external edits made while the modal was open.
                        // Runs BEFORE any image download work starts.
                        this.assertNotStale(await this.app.vault.read(file), snapshotContent, file);

                        // IMAGE PHASE 1: download eligible attachment images
                        // into memory buffers (no vault writes yet). External
                        // URLs are never fetched. Skipped entirely when the
                        // importImages setting is off or the page has none.
                        let body = diffResult.remoteContent;
                        if (diffResult.imageRefs.length > 0) {
                            if (this.settings.importImages) {
                                new Notice(`🖼 Downloading ${diffResult.imageRefs.length} image(s)…`);
                                imageSummary = await imageImporter.downloadAll(
                                    pageInfo.pageId, diffResult.imageRefs, file.path, attachmentLinks
                                );
                            } else {
                                // Setting disabled: keep every image as a plain
                                // remote link (no failure callout, no network).
                                body = this.replaceTokensWithRemoteLinks(body, diffResult, apiClient);
                            }
                        }

                        // Unload guard again after potentially slow downloads.
                        if (this._unloading) {
                            if (imageSummary) await imageImporter.rollback(imageSummary);
                            throw new Error('Plugin unloaded — apply cancelled.');
                        }

                        // SECOND stale check: after downloads, before writes.
                        const currentContent = await this.app.vault.read(file);
                        try {
                            this.assertNotStale(currentContent, snapshotContent, file);
                        } catch (e) {
                            if (imageSummary) await imageImporter.rollback(imageSummary);
                            throw e;
                        }

                        // IMAGE PHASE 2: write buffered attachments into the
                        // vault (default attachment location), then replace
                        // the exact placeholder tokens.
                        if (imageSummary) {
                            await imageImporter.writeBuffers(imageSummary, file.path);
                            body = ImageImporter.applyReplacements(body, imageSummary.outcomes);
                        }

                        // THIRD stale check: immediately before note write.
                        // Runs AFTER potentially slow sequential writes.
                        const finalContent = await this.app.vault.read(file);
                        try {
                            if (this._unloading) throw new Error('Plugin unloaded — apply cancelled.');
                            this.assertNotStale(finalContent, snapshotContent, file);
                        } catch (e) {
                            if (imageSummary) await imageImporter.rollback(imageSummary);
                            throw e;
                        }

                        // Write the note body. The frontmatter is taken from
                        // the just-re-read file so any frontmatter-only edits
                        // (e.g. tags added during the pull process) are preserved.
                        const { frontmatter: finalFrontmatter } =
                            this.extractFrontmatter(finalContent);
                        const fullContent = finalFrontmatter
                            ? finalFrontmatter + '\n' + body
                            : body;
                        try {
                            await this.app.vault.modify(file, fullContent);
                        } catch (e) {
                            // Note write failed: roll back attachments created
                            // in this attempt so no orphans remain.
                            if (imageSummary) await imageImporter.rollback(imageSummary);
                            throw e;
                        }

                        // Record which remote version this pull was based on.
                        // Uses processFrontMatter so ONLY confluence-version is
                        // touched — all other properties are left intact.
                        //
                        // CONSISTENCY: the note body was already written. If the
                        // version update fails, content and version metadata
                        // would disagree, so we attempt a SAFE rollback — full
                        // transactionality is impossible with two separate
                        // writes, so safety is bounded by a re-read compare.
                        try {
                            await this.updateVersionInFrontmatter(file, remotePage.version.number);
                        } catch (versionError) {
                            await this.recoverFromVersionUpdateFailure(
                                file, fullContent, snapshotContent, imageSummary, imageImporter
                            );
                            this.logger.error('Version metadata update failed', versionError);
                            // '⚠' prefix: recovery already showed the precise
                            // Notice — suppress the generic error Notice while
                            // still keeping the modal open for retry.
                            throw new Error('⚠ Version metadata update failed — see notice.');
                        }

                        if (imageSummary && (imageSummary.imported + imageSummary.reused + imageSummary.failed + imageSummary.keptRemote) > 0) {
                            new Notice(
                                `✅ Note updated. 圖片:${imageSummary.imported} 匯入、` +
                                `${imageSummary.reused} 重用、${imageSummary.failed} 失敗(保留遠端連結)、` +
                                `${imageSummary.keptRemote} 外部保留遠端。`,
                                8000
                            );
                        } else {
                            new Notice('✅ Local note replaced with Confluence version.', 5000);
                        }
                        this.logger.info('Pull sync complete: local file replaced, Confluence untouched.', {
                            imported: imageSummary?.imported ?? 0,
                            reused: imageSummary?.reused ?? 0,
                            failedImages: imageSummary?.failed ?? 0,
                            keptRemote: imageSummary?.keptRemote ?? 0,
                        });
                    } catch (error) {
                        this.logger.error('Error while applying pulled content locally', error);
                        if (!(error instanceof Error && error.message.startsWith('⚠'))) {
                            // Only surface non-abort errors to the generic handler
                            // (the abort Notice was already shown above).
                            this.handleError(error);
                        }
                        // Re-throw so the modal stays open and the user can
                        // retry or cancel (see ConflictResolutionModal).
                        throw error;
                    }
                });
            }

        } catch (error) {
            this.logger.error('Error in syncFromConfluence', error);
            this.handleError(error);
        }
    }

    /**
     * Guard against credential exfiltration: the confluence-url in a note's
     * frontmatter must point at the SAME origin (protocol + host) as the
     * user-configured Base URL. Matching only the host is insufficient —
     * an attacker-controlled note could downgrade https→http, causing
     * credentials to be sent in cleartext to a network sniffer.
     * Without a configured base URL we refuse to send credentials anywhere.
     */
    private assertAllowedHost(urlBase: string): void {
        const configured = (this.settings.baseUrl || '').trim();
        if (!configured) {
            throw new Error(
                'Confluence Base URL is not configured. Set it in Settings → Confluence Page Import ' +
                'so the plugin only sends credentials to your own Confluence host.'
            );
        }

        let configuredUrl: URL;
        let targetUrl: URL;
        try {
            configuredUrl = new URL(configured);
        } catch {
            throw new Error(`Configured Confluence Base URL is not a valid URL: ${configured}`);
        }
        try {
            targetUrl = new URL(urlBase);
        } catch {
            throw new Error(`Invalid confluence-url in note frontmatter: ${urlBase}`);
        }

        const configuredProtocol = configuredUrl.protocol.toLowerCase();
        const targetProtocol = targetUrl.protocol.toLowerCase();
        const configuredHost = configuredUrl.host.toLowerCase();
        const targetHost = targetUrl.host.toLowerCase();

        // Fail closed on embedded credentials (https://user:pass@host/…).
        // Userinfo in a note-controlled URL is a phishing/exfiltration vector
        // and must never be silently ignored.
        if (targetUrl.username || targetUrl.password) {
            throw new Error(
                "Blocked sync: this note's confluence-url contains embedded credentials " +
                '(user:password@). Remove the userinfo part from the URL.'
            );
        }
        if (configuredUrl.username || configuredUrl.password) {
            throw new Error(
                'Configured Confluence Base URL must not contain embedded credentials ' +
                '(user:password@). Use the email + API token fields instead.'
            );
        }

        // Only http(s) is ever allowed for a Confluence server.
        if (targetProtocol !== 'http:' && targetProtocol !== 'https:') {
            throw new Error(
                `Blocked sync: this note's confluence-url uses unsupported protocol "${targetProtocol}". ` +
                'Only http and https are allowed.'
            );
        }
        if (configuredProtocol !== 'http:' && configuredProtocol !== 'https:') {
            throw new Error(
                `Configured Confluence Base URL uses unsupported protocol "${configuredProtocol}". ` +
                'Only http and https are allowed.'
            );
        }

        if (targetHost !== configuredHost) {
            throw new Error(
                `Blocked sync: this note's confluence-url points to "${targetHost}", ` +
                `which does not match your configured Confluence host "${configuredHost}". ` +
                'Credentials are only ever sent to the configured host.'
            );
        }

        // Refuse any scheme downgrade (e.g. configured https → note http).
        // An upgrade (http→https) is also unexpected but merely surprising
        // rather than dangerous; we block it too for consistency.
        if (targetProtocol !== configuredProtocol) {
            throw new Error(
                `Blocked sync: this note's confluence-url uses protocol "${targetProtocol}" ` +
                `but the configured base URL uses "${configuredProtocol}". ` +
                'The protocols must match to prevent credential exposure.'
            );
        }
    }

    /** Throws the standard stale-file abort when content changed since snapshot. */
    private assertNotStale(currentContent: string, snapshotContent: string, file: TFile): void {
        if (currentContent !== snapshotContent) {
            const msg =
                '⚠ The note was modified while the sync dialog was open. ' +
                'Pull aborted to preserve your changes. Please close and re-sync.';
            new Notice(msg, 10000);
            this.logger.warn('Apply aborted: file changed during modal', {
                path: file.path,
            });
            throw new Error(msg);
        }
    }

    /**
     * importImages=false path: replace every image token with a plain remote
     * representation (no download, no failure callout, no credentials).
     * Attachment refs (no public URL known without metadata) keep an
     * external-style informational block pointing at the configured site.
     */
    private replaceTokensWithRemoteLinks(
        body: string,
        diffResult: DiffResult,
        apiClient: ConfluenceApiClient
    ): string {
        let result = body;
        for (const ref of diffResult.imageRefs) {
            let replacement: string;
            if (ref.kind === 'url' && ref.url) {
                replacement = `![${ref.alt || 'image'}](${escapeUrlForMarkdown(ref.url)})`;
            } else {
                // Attachment without download: name it and note it was not imported.
                const alt = ref.alt || ref.filename || 'image';
                replacement = [
                    `> [!info] 圖片未下載(圖片匯入已停用)`,
                    `> 附件:${escapeUrlForMarkdown(ref.filename ?? alt)}(位於 ${escapeUrlForMarkdown(apiClient.getBaseUrl())})`,
                ].join('\n');
            }
            result = result.split(ref.token).join(replacement);
        }
        return result;
    }

    /**
     * Recovery when the note body write succeeded but the frontmatter
     * version update failed. Decision table:
     *
     * | Current note state (re-read)        | Action                                             |
     * |-------------------------------------|----------------------------------------------------|
     * | exactly equals just-applied content | roll note back to original snapshot; trash ONLY    |
     * |                                     | attachments created this attempt (reused kept)     |
     * | anything else (user edited already) | keep current note & attachments; high-severity     |
     * |                                     | Notice: version metadata failed, re-sync required  |
     * | rollback modify itself fails        | keep current state; high-severity Notice           |
     *
     * Full transactionality is impossible (two separate writes); this keeps
     * the note either fully old or fully new, and never overwrites a user
     * edit that happened after the body write.
     */
    private async recoverFromVersionUpdateFailure(
        file: TFile,
        appliedContent: string,
        originalSnapshot: string,
        imageSummary: ImageImportSummary | null,
        imageImporter: ImageImporter
    ): Promise<void> {
        this.logger.error('Frontmatter version update failed after note write; attempting safe recovery');

        let current: string;
        try {
            current = await this.app.vault.read(file);
        } catch {
            new Notice(
                '❌ 版本資訊更新失敗,且無法讀取目前筆記狀態。筆記內容已更新,' +
                '但 confluence-version 未更新 — 請重新執行匯入以修正版本資訊。',
                12000
            );
            return;
        }

        if (current === appliedContent) {
            // Safe to roll back: nobody touched the note since our write.
            try {
                await this.app.vault.modify(file, originalSnapshot);
            } catch {
                new Notice(
                    '❌ 版本資訊更新失敗,且筆記回滾也失敗。筆記目前是新內容,' +
                    '但 confluence-version 未更新 — 請重新執行匯入。',
                    12000
                );
                return;
            }
            // Note restored to the original snapshot (including its original
            // frontmatter/version). Now trash only files created this attempt.
            if (imageSummary) {
                const orphans = await this.rollbackAttachmentsReportingOrphans(imageSummary, imageImporter);
                if (orphans.length > 0) {
                    new Notice(
                        `⚠ 已回滾筆記,但 ${orphans.length} 個附件檔案無法移至垃圾桶,請手動清理:` +
                        orphans.join('、'),
                        12000
                    );
                }
            }
            new Notice(
                '⚠ 版本資訊更新失敗,筆記已安全回滾為原始內容。請重新執行匯入。',
                10000
            );
        } else {
            // The note changed after our write — do NOT overwrite the user.
            new Notice(
                '❌ 版本資訊更新失敗(筆記內容已是新版本且其後已有變動,未回滾)。' +
                'confluence-version 未更新 — 下次匯入會重新比較;請重新執行匯入以修正版本資訊。',
                12000
            );
        }
    }

    /** Rollback wrapper that reports paths it could not trash. */
    private async rollbackAttachmentsReportingOrphans(
        summary: ImageImportSummary,
        importer: ImageImporter
    ): Promise<string[]> {
        const before = [...summary.createdPaths];
        await importer.rollback(summary);
        // rollback() clears createdPaths for successfully trashed files and
        // logs failures; verify which paths still exist to report orphans.
        const orphans: string[] = [];
        for (const path of before) {
            if (this.app.vault.getAbstractFileByPath(path)) {
                orphans.push(path);
            }
        }
        return orphans;
    }

    private async updateVersionInFrontmatter(file: TFile, newVersion: number): Promise<void> {
        await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
            frontmatter['confluence-version'] = newVersion;
        });
        this.logger.info(`Updated local frontmatter version to ${newVersion}`);
    }

    private extractFrontmatter(content: string): { frontmatter: string; content: string } {
        const lines = content.split('\n');
        if (lines[0]?.trim() === '---') {
            let endIndex = -1;
            for (let i = 1; i < lines.length; i++) {
                if (lines[i].trim() === '---') {
                    endIndex = i;
                    break;
                }
            }
            if (endIndex !== -1) {
                return {
                    frontmatter: lines.slice(0, endIndex + 1).join('\n'),
                    content: lines.slice(endIndex + 1).join('\n')
                };
            }
        }
        return { frontmatter: '', content };
    }

    /**
     * Opens the diff-preview modal and resolves when the modal is CLOSED
     * (pull accepted or cancelled/dismissed). This makes the whole
     * fetch → modal → apply lifecycle awaitable so the per-file in-flight
     * guard covers user interaction time.
     */
    private showPullPreview(
        diffResult: DiffResult,
        onAccept: () => Promise<void>
    ): Promise<void> {
        return new Promise<void>((resolve) => {
            const modal = new ConflictResolutionModal(
                this.app,
                diffResult,
                onAccept,
                () => {
                    this._activeModal = null;
                    resolve();
                }
            );
            this._activeModal = modal;
            modal.open();
        });
    }

    private validateSettings(): void {
        if (!this.settings.apiToken || !this.settings.userEmail) {
            throw new Error('Confluence credentials not configured. Please check Settings.');
        }
    }

    private async getConfluenceMetadata(file: TFile): Promise<{
        confluenceUrl?: string;
    }> {
        const cache = this.app.metadataCache.getFileCache(file);
        // FrontMatterCache already has an index signature; no assertion needed.
        const frontmatter = cache?.frontmatter;

        if (!frontmatter) {
            throw new Error('No frontmatter found in note');
        }

        const confluenceUrl: unknown = frontmatter['confluence-url'];

        if (typeof confluenceUrl !== 'string') {
            throw new Error('No confluence-url found in note properties');
        }

        return { confluenceUrl };
    }

    private handleError(error: unknown): void {
        if (error instanceof ConfluenceApiError) {
            if (error.status === 401) {
                new Notice('❌ Authentication failed. Check your API token in Settings.', 8000);
            } else if (error.status === 403) {
                new Notice('❌ Access denied. You may not have permission to view this page.', 8000);
            } else if (error.status === 404) {
                new Notice('❌ Page not found. The page may have been deleted or moved.', 8000);
            } else if (error.status === 429) {
                new Notice('❌ Confluence rate limit exceeded. Please wait a moment and try again.', 8000);
            } else if (error.status === 0) {
                // Status 0 is used for client-side validation errors (e.g. invalid shape).
                new Notice(`❌ Sync error: ${error.body}`, 8000);
            } else {
                new Notice(`❌ Confluence error: ${error.message}`, 8000);
            }
        } else {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(`❌ Error: ${message}`, 8000);
        }

        this.logger.error('Confluence sync error', error);
    }
}
