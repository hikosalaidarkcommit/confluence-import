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
            const { frontmatter, content: localBody } = this.extractFrontmatter(localMarkdown);

            // Step 5: Perform diff
            new Notice('🔄 Checking for conflicts...');
            const diffEngine = new DiffEngine();
            // remotePage.body.storage.value is XHTML.
            const diffResult = await diffEngine.compare(
                localBody,
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
                        const newVersion = await this.uploadContent(
                            apiClient,
                            pageInfo.pageId,
                            remotePage.title,
                            merged,
                            remotePage.version.number
                        );

                        // Update local file with merged content
                        // Reconstruct file with original frontmatter + merged body
                        const fullContent = frontmatter ? frontmatter + '\n' + merged : merged;
                        await this.app.vault.modify(file, fullContent);

                        // Update version in frontmatter
                        await this.updateVersionInFrontmatter(file, newVersion);

                        this.logger.info('Updated local file with merged content and new version');
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
    ): Promise<number> {

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
        const updatedPage = await apiClient.updatePage(
            pageId,
            title,
            storageFormat,
            currentVersion
        );

        new Notice('✅ Successfully pushed to Confluence!', 5000);
        return updatedPage.version.number;
    }

    private async updateVersionInFrontmatter(file: TFile, newVersion: number): Promise<void> {
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
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
