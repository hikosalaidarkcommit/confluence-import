import { Plugin, TFile, Notice, MarkdownView } from 'obsidian';
import { ConfluenceSettingsTab, ConfluenceSyncPluginInterface } from './settings';
import { ConfluenceSyncService } from './services/sync-service';
import { DEFAULT_SETTINGS, ConfluenceSettings } from './models';

import { PluginLogger } from './utils/logger';

export default class ConfluenceSyncPlugin extends Plugin implements ConfluenceSyncPluginInterface {
    settings: ConfluenceSettings;
    syncService: ConfluenceSyncService;
    logger: PluginLogger;

    // Pending debounce timer for text-field settings saves.
    private _saveDebounceTimer: number | null = null;

    /**
     * Start the plugin initialization. Plugin.onload() expects a void return
     * but allows async implementations. To satisfy scanners that might strictly
     * check the base type contract, we handle initialization in a void-returning
     * async chain.
     */
    onload(): void {
        this.initializePlugin().catch((err: unknown) => {
            console.error('[Confluence Page Import] Failed to initialize plugin', err);
        });
    }

    private async initializePlugin(): Promise<void> {
        // Load settings
        await this.loadSettings();

        // Initialize Logger using the DataAdapter API.
        // manifest.dir is a documented optional field; fall back to a
        // predictable path when the host doesn't populate it.
        const pluginDir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
        
        this.logger = new PluginLogger(this.settings, this.app.vault.adapter, pluginDir);
        this.logger.info('Plugin loading');

        // Initialize sync service — created ONCE for the plugin's lifetime.
        // Settings are updated in-place via syncService.updateSettings() so
        // the resolver cache and in-flight guard are never accidentally reset.
        this.syncService = new ConfluenceSyncService(
            this.app,
            this.settings,
            this.logger
        );

        // Add settings tab
        this.addSettingTab(new ConfluenceSettingsTab(this.app, this));

        // Add ribbon icon
        this.addRibbonIcon('cloud-download', 'Import from Confluence', () => {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) {
                this.syncService.syncFromConfluence(activeFile).catch((err: unknown) => {
                    this.logger.error('Ribbon sync failed', err);
                });
            } else {
                new Notice('No active file to import into');
            }
        });

        // Add command — one-way PULL from Confluence into the local note.
        this.addCommand({
            id: 'import-from-confluence',
            name: 'Import current note from Confluence',
            checkCallback: (checking: boolean) => {
                const activeFile = this.app.workspace.getActiveFile();

                if (activeFile && activeFile.extension === 'md') {
                    if (!checking) {
                        this.syncService.syncFromConfluence(activeFile).catch((err: unknown) => {
                            this.logger.error('Command sync failed', err);
                        });
                    }
                    return true;
                }

                return false;
            }
        });

        // Add context menu
        this.registerEvent(
            this.app.workspace.on('file-menu', (menu, file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    menu.addItem((item) => {
                        item
                            .setTitle('Import from Confluence')
                            .setIcon('cloud-download')
                            .onClick(() => {
                                this.syncService.syncFromConfluence(file).catch((err: unknown) => {
                                    this.logger.error('File-menu sync failed', err);
                                });
                            });
                    });
                }
            })
        );

        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, _editor, view) => {
                // Narrow view to MarkdownView to safely access the file property.
                if (view instanceof MarkdownView) {
                    const mdFile = view.file;
                    if (mdFile instanceof TFile) {
                        menu.addItem((item) => {
                            item
                                .setTitle('Import from Confluence')
                                .setIcon('cloud-download')
                                .onClick(() => {
                                    this.syncService.syncFromConfluence(mdFile).catch((err: unknown) => {
                                        this.logger.error('Editor-menu sync failed', err);
                                    });
                                });
                        });
                    }
                }
            })
        );

        this.logger.info('Plugin loaded');
    }

    onunload(): void {
        this.finalizePlugin().catch((err: unknown) => {
            console.error('[Confluence Page Import] Error during unload', err);
        });
    }

    private async finalizePlugin(): Promise<void> {
        this.logger.info('Plugin unloading');
        // Flush any pending settings write.
        if (this._saveDebounceTimer !== null) {
            window.clearTimeout(this._saveDebounceTimer);
            this._saveDebounceTimer = null;
            await this.saveData(this.settings);
        }
        // Signal the service to close any open modal and prevent pending
        // apply callbacks from writing to disk after unload.
        this.syncService.unload();
        // Flush queued log writes and stop accepting new entries.
        await this.logger.close();
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
        // Update the existing service in-place — this preserves the resolver
        // cache and the per-file in-flight guard across settings changes.
        this.syncService.updateSettings(this.settings);
    }

    /**
     * Debounced save for text input fields (fired on every keystroke).
     * Batches rapid changes into a single disk write and service update so
     * that:
     *   - data.json is not written on every key press, and
     *   - the SyncService instance (and its page-ID cache) is never rebuilt.
     *
     * Toggled settings (booleans) should call saveSettings() directly because
     * they fire at most once per user action.
     */
    saveSettingsDebounced(delayMs = 400): void {
        if (this._saveDebounceTimer !== null) {
            window.clearTimeout(this._saveDebounceTimer);
        }
        this._saveDebounceTimer = window.setTimeout(() => {
            this._saveDebounceTimer = null;
            this.saveSettings().catch((err: unknown) => {
                this.logger.error('Debounced save failed', err);
            });
        }, delayMs);
    }
}
