import { Plugin, TFile, Notice, FileSystemAdapter } from 'obsidian';
import { ConfluenceSettingsTab, ConfluenceSyncPluginInterface } from './settings';
import { ConfluenceSyncService } from './services/sync-service';
import { DEFAULT_SETTINGS, ConfluenceSettings } from './models';

import { PluginLogger } from './utils/logger';

export default class ConfluenceSyncPlugin extends Plugin implements ConfluenceSyncPluginInterface {
    settings: ConfluenceSettings;
    syncService: ConfluenceSyncService;
    logger: PluginLogger;

    // Pending debounce timer for text-field settings saves.
    private _saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    async onload() {
        // Load settings
        await this.loadSettings();

        // Initialize Logger using the public FileSystemAdapter API.
        // manifest.dir is a documented optional field; fall back to a
        // predictable path when the host doesn't populate it (e.g. unit tests).
        const pluginDir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
        let vaultPath = '';
        if (this.app.vault.adapter instanceof FileSystemAdapter) {
            vaultPath = this.app.vault.adapter.getBasePath();
        }
        // When not on desktop (FileSystemAdapter unavailable), the logger path
        // will be empty — PluginLogger falls back silently to console.error.

        this.logger = new PluginLogger(this.settings, pluginDir, vaultPath);
        this.logger.info('Plugin loaded');

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
        this.addRibbonIcon('cloud-download', 'Sync from Confluence', async () => {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) {
                await this.syncService.syncFromConfluence(activeFile);
            } else {
                new Notice('No active file to sync');
            }
        });

        // Add command
        // NOTE: The command id is kept as 'push-to-confluence' (invisible to users)
        // only so existing hotkey mappings keep working. The behavior is now a
        // one-way PULL from Confluence into the local note.
        this.addCommand({
            id: 'push-to-confluence',
            name: 'Sync current note from Confluence',
            checkCallback: (checking: boolean) => {
                const activeFile = this.app.workspace.getActiveFile();

                if (activeFile && activeFile.extension === 'md') {
                    if (!checking) {
                        this.syncService.syncFromConfluence(activeFile);
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
                            .setTitle('Sync from Confluence')
                            .setIcon('cloud-download')
                            .onClick(async () => {
                                await this.syncService.syncFromConfluence(file);
                            });
                    });
                }
            })
        );

        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor, view) => {
                // MarkdownView has a `file` property; guard with a runtime check
                // because the type definitions don't expose it on EditorMenuContext.
                const mdFile = (view as any).file;
                if (mdFile instanceof TFile) {
                    menu.addItem((item) => {
                        item
                            .setTitle('Sync from Confluence')
                            .setIcon('cloud-download')
                            .onClick(async () => {
                                await this.syncService.syncFromConfluence(mdFile);
                            });
                    });
                }
            })
        );
    }

    async onunload() {
        this.logger.info('Plugin unloading');
        // Flush any pending settings write.
        if (this._saveDebounceTimer !== null) {
            clearTimeout(this._saveDebounceTimer);
            this._saveDebounceTimer = null;
            await this.saveData(this.settings);
        }
        // Signal the service to close any open modal and prevent pending
        // apply callbacks from writing to disk after unload.
        this.syncService.unload();
        // Flush queued log writes and stop accepting new entries.
        await this.logger.close();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
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
            clearTimeout(this._saveDebounceTimer);
        }
        this._saveDebounceTimer = setTimeout(async () => {
            this._saveDebounceTimer = null;
            await this.saveSettings();
        }, delayMs);
    }
}
