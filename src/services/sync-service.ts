import { App, TFile, Notice, Vault } from 'obsidian';
import { ConfluenceSettings, DiffResult } from '../models';
import { ConfluenceUrlParser } from '../api/url-parser';
import { ConfluenceApiClient, ConfluenceApiError } from '../api/confluence-client';
import { CachedPageResolver } from '../api/page-resolver';
import { DiffEngine } from '../diff/diff-engine';
import { ConflictResolutionModal } from '../ui/conflict-modal';
import { MarkdownToConfluenceConverter } from '../converters/markdown-converter';

import { PluginLogger } from '../utils/logger';

export class ConfluenceSyncService {
    private _settings: ConfluenceSettings;
    private app: App;
    private logger: PluginLogger;

    constructor(app: App, settings: ConfluenceSettings, logger: PluginLogger) {
        this.app = app;
        this._settings = settings;
        this.logger = logger;
    }

    // Getter for settings to ensure we use latest
    private get settings(): ConfluenceSettings {
        return this._settings;
    }

    async pushToConfluence(file: TFile): Promise<void> {
        this.logger.info(`Starting push for file: ${file.path}`);
        try {
            // Step 1: Validate prerequisites
            this.validateSettings();
            const metadata = await this.getConfluenceMetadata(file);
            this.logger.info('Metadata retrieved', metadata);

            // Step 2: Parse URL
            const parser = new ConfluenceUrlParser();
            const parsed = parser.parse(metadata.confluenceUrl!);
            this.logger.info('Parsed URL', parsed);

            const apiClient = new ConfluenceApiClient({
                baseUrl: parsed.baseUrl,
                email: this.settings.userEmail,
                apiToken: this.settings.apiToken
            });

            new Notice('🔍 Resolving Confluence page...');

            const resolver = new CachedPageResolver(apiClient);
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

            // Step 4: Get local content
            const localMarkdown = await this.app.vault.read(file);

            // Step 5: Perform diff
            new Notice('🔄 Checking for conflicts...');
            const diffEngine = new DiffEngine();
            // remotePage.body.storage.value is XHTML.
            const diffResult = await diffEngine.compare(
                localMarkdown,
                remotePage.body.storage.value
            );
            diffResult.remoteVersion = remotePage.version.number;
            this.logger.info('Diff result', { hasConflicts: diffResult.hasConflicts, changesCount: diffResult.diffLines.filter(l => l.type !== 'unchanged').length });

            // Step 6: Handle conflicts or proceed
            if (diffResult.hasConflicts) {
                if (diffResult.diffLines.every(l => l.type === 'unchanged')) {
                    this.logger.info('Content identical');
                    new Notice('✓ Content is identical to Confluence.');
                } else {
                    this.logger.info('Showing conflict resolution or reviewing changes');
                    // Show conflict resolution modal
                    await this.showConflictResolution(diffResult, async (merged) => {
                        this.logger.info('Conflict resolved/Reviewed, uploading content');
                        await this.uploadContent(
                            apiClient,
                            pageInfo.pageId,
                            remotePage.title,
                            merged,
                            remotePage.version.number
                        );
                    });
                }
            } else {
                // If DiffEngine reported no conflicts (which implies identical or auto-mergeable if we had a better engine)
                // For now, DiffEngine reports "hasConflicts" for any change. 
                // So this else block is technically unreachable for changed content with current engine implementation
            }

        } catch (error) {
            this.logger.error('Error in pushToConfluence', error);
            this.handleError(error);
        }
    }

    private async uploadContent(
        apiClient: ConfluenceApiClient,
        pageId: string,
        title: string,
        markdown: string,
        currentVersion: number
    ): Promise<void> {

        // Convert markdown to Confluence storage format
        new Notice('📝 Converting content...');
        const converter = new MarkdownToConfluenceConverter(
            // @ts-ignore - access inner generic adapter?
            this.app.vault.adapter.basePath || (this.app.vault.adapter as any).basePath || '.',
            apiClient,
            async (path) => await this.app.vault.adapter.readBinary(path)
        );
        const storageFormat = await converter.convert(markdown, pageId);

        // Upload to Confluence
        new Notice('⬆ Uploading to Confluence...');
        await apiClient.updatePage(
            pageId,
            title,
            storageFormat,
            currentVersion
        );

        new Notice('✅ Successfully pushed to Confluence!', 5000);
    }

    private async showConflictResolution(
        diffResult: DiffResult,
        onResolve: (merged: string) => Promise<void>
    ): Promise<void> {

        const modal = new ConflictResolutionModal(
            this.app,
            diffResult,
            onResolve
        );

        modal.open();
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
        const frontmatter = cache?.frontmatter;

        if (!frontmatter) {
            throw new Error('No frontmatter found in note');
        }

        const confluenceUrl = frontmatter['confluence-url'];

        if (!confluenceUrl) {
            throw new Error('No confluence-url found in note properties');
        }

        return { confluenceUrl };
    }

    private handleError(error: any): void {
        if (error instanceof ConfluenceApiError) {
            if (error.status === 401) {
                new Notice('❌ Authentication failed. Check your API token in Settings.', 8000);
            } else if (error.status === 403) {
                new Notice('❌ Access denied. You may not have permission to edit this page.', 8000);
            } else if (error.status === 404) {
                new Notice('❌ Page not found. The page may have been deleted.', 8000);
            } else {
                new Notice(`❌ Confluence error: ${error.message}`, 8000);
            }
        } else {
            new Notice(`❌ Error: ${error.message}`, 8000);
        }

        console.error('Confluence sync error:', error);
    }
}
