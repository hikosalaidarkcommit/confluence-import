import { Plugin, TFile, Notice, WorkspaceLeaf } from 'obsidian';
import { ConfluenceSettingsTab, ConfluenceSyncPluginInterface } from './settings';
import { ConfluenceSyncService } from './services/sync-service';
import { DEFAULT_SETTINGS, ConfluenceSettings } from './models';

import { PluginLogger } from './utils/logger';

export default class ConfluenceSyncPlugin extends Plugin implements ConfluenceSyncPluginInterface {
    settings: ConfluenceSettings;
    syncService: ConfluenceSyncService;
    logger: PluginLogger;

    async onload() {
        console.log('Loading Confluence Sync plugin');

        // Load settings
        await this.loadSettings();

        // Initialize Logger
        // @ts-ignore
        const pluginDir = this.manifest.dir || `plugins/${this.manifest.id}`;
        // @ts-ignore
        const vaultPath = this.app.vault.adapter.basePath;

        this.logger = new PluginLogger(this.settings, pluginDir, vaultPath);
        this.logger.info('Plugin loaded');

        // Initialize sync service
        this.syncService = new ConfluenceSyncService(
            this.app,
            this.settings,
            this.logger
        );

        // Add settings tab
        this.addSettingTab(new ConfluenceSettingsTab(this.app, this));

        // Add ribbon icon
        this.addRibbonIcon('cloud-upload', 'Push to Confluence', async () => {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) {
                await this.syncService.pushToConfluence(activeFile);
            } else {
                new Notice('No active file to push');
            }
        });

        // Add command
        this.addCommand({
            id: 'push-to-confluence',
            name: 'Push current note to Confluence',
            checkCallback: (checking: boolean) => {
                const activeFile = this.app.workspace.getActiveFile();

                if (activeFile && activeFile.extension === 'md') {
                    if (!checking) {
                        this.syncService.pushToConfluence(activeFile);
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
                            .setTitle('Push to Confluence')
                            .setIcon('cloud-upload')
                            .onClick(async () => {
                                await this.syncService.pushToConfluence(file);
                            });
                    });
                }
            })
        );

        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor, view) => { // Type definition mismatch potentially, use 'any' if needed or infer
                // @ts-ignore
                if (view.file) {
                    menu.addItem((item) => {
                        item
                            .setTitle('Push to Confluence')
                            .setIcon('cloud-upload')
                            .onClick(async () => {
                                // @ts-ignore
                                await this.syncService.pushToConfluence(view.file!);
                            });
                    });
                }
            })
        );
    }

    async onunload() {
        console.log('Unloading Confluence Sync plugin');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        // Update service settings reference if needed (though we passed object ref)
        // Actually, recreating service is safer if settings object is replaced
        this.syncService = new ConfluenceSyncService(this.app, this.settings, this.logger);
    }
}
