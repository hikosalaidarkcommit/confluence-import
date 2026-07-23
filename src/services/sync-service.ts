import { App, TFile, Notice } from 'obsidian';
import { ConfluenceSettings, DiffResult } from '../models';
import { ConfluenceUrlParser } from '../api/url-parser';
import { ConfluenceApiClient, ConfluenceApiError } from '../api/confluence-client';
import { CachedPageResolver, ConfluencePageResolver } from '../api/page-resolver';
import { DiffEngine } from '../diff/diff-engine';
import { ConflictResolutionModal } from '../ui/conflict-modal';

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

            // Step 5: Perform diff
            new Notice('🔄 Checking for conflicts...');
            const diffEngine = new DiffEngine(this.logger);
            // remotePage.body.storage.value is XHTML.
            const diffResult = await diffEngine.compare(
                localBody,
                remotePage.body.storage.value
            );
            diffResult.remoteVersion = remotePage.version.number;
            this.logger.info('Diff result', {
                hasConflicts: diffResult.hasConflicts,
                localLength: diffResult.localContent.length,
                remoteLength: diffResult.remoteContent.length
            });

            // Step 6: Handle identical content, differences, or finish
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

                        // Re-read the current file state to detect any external
                        // edits that happened while the modal was open.
                        const currentContent = await this.app.vault.read(file);
                        if (currentContent !== snapshotContent) {
                            // Fail closed: preserve the user's external edit.
                            // The modal stays open so the user can retry or cancel.
                            const msg =
                                '⚠ The note was modified while the sync dialog was open. ' +
                                'Pull aborted to preserve your changes. Please close and re-sync.';
                            new Notice(msg, 10000);
                            this.logger.warn('Apply aborted: file changed during modal', {
                                path: file.path,
                            });
                            throw new Error(msg);
                        }

                        // Write the remote content. The frontmatter is taken
                        // from the just-re-read file so any frontmatter-only
                        // edits (e.g. tags added while reviewing) are preserved.
                        const { frontmatter: currentFrontmatter } =
                            this.extractFrontmatter(currentContent);
                        const fullContent = currentFrontmatter
                            ? currentFrontmatter + '\n' + diffResult.remoteContent
                            : diffResult.remoteContent;
                        await this.app.vault.modify(file, fullContent);

                        // Record which remote version this pull was based on.
                        // Uses processFrontMatter so ONLY confluence-version is
                        // touched — all other properties are left intact.
                        await this.updateVersionInFrontmatter(file, remotePage.version.number);

                        new Notice('✅ Local note replaced with Confluence version.', 5000);
                        this.logger.info('Pull sync complete: local file replaced, Confluence untouched.');
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

        const confluenceUrl = frontmatter['confluence-url'];

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
