import { App, PluginSettingTab, Setting, Plugin, Notice } from 'obsidian';
import { ConfluenceSettings } from './models';
import { ConfluenceApiClient } from './api/confluence-client';

export interface ConfluenceSyncPluginInterface extends Plugin {
    settings: ConfluenceSettings;
    saveSettings(): Promise<void>;
    /**
     * Debounced variant of saveSettings() for text-field onChange handlers.
     * Prevents a disk write and service update on every keystroke.
     */
    saveSettingsDebounced(delayMs?: number): void;
}

export class ConfluenceSettingsTab extends PluginSettingTab {
    plugin: ConfluenceSyncPluginInterface;

    constructor(app: App, plugin: ConfluenceSyncPluginInterface) {
        super(app, plugin);
        this.plugin = plugin;
    }

    /**
     * Implement the declarative settings API (Obsidian 1.13+) so that settings
     * are discoverable via Obsidian's settings search.
     */
    getSettingDefinitions() {
        return {
            'baseUrl': {
                name: 'Confluence Base URL',
                type: 'text',
            },
            'userEmail': {
                name: 'Confluence User Email',
                type: 'text',
            },
            'apiToken': {
                name: 'Confluence API Token',
                type: 'text',
            },
            'defaultSpace': {
                name: 'Default Space Key',
                type: 'text',
            },
            'enableDebugLogging': {
                name: 'Enable debug logging',
                type: 'toggle',
            },
            'enablePageIdCache': {
                name: 'Cache page IDs',
                type: 'toggle',
            }
        };
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();
        
        new Setting(containerEl)
            .setName('Connection')
            .setHeading();

        containerEl.createEl('p', {
            text: 'ℹ Base URL is required. For security, sync only sends credentials to this host — notes whose confluence-url points elsewhere are rejected.',
            cls: 'setting-item-description'
        });

        new Setting(containerEl)
            .setName('Confluence Base URL')
            .setDesc('Required. Credentials are only sent to this host (e.g., https://mycompany.atlassian.net)')
            .addText(text => text
                .setPlaceholder('https://confluence.example.com')
                .setValue(this.plugin.settings.baseUrl)
                .onChange(async (value) => {
                    this.plugin.settings.baseUrl = value.replace(/\/$/, ''); // Remove trailing slash
                    this.plugin.saveSettingsDebounced();
                }));

        new Setting(containerEl)
            .setName('Confluence User Email')
            .setDesc('Used for Confluence API authentication')
            .addText(text => text
                .setPlaceholder('user@example.com')
                .setValue(this.plugin.settings.userEmail)
                .onChange(async (value) => {
                    this.plugin.settings.userEmail = value;
                    this.plugin.saveSettingsDebounced();
                }));

        new Setting(containerEl)
            .setName('Confluence API Token')
            .setDesc('Generate from: Confluence → Profile → Settings → Personal Access Tokens')
            .addText(text => text
                .setPlaceholder('••••••••••••••••••••••••••••')
                .setValue(this.plugin.settings.apiToken)
                .onChange(async (value) => {
                    this.plugin.settings.apiToken = value;
                    this.plugin.saveSettingsDebounced();
                }))
            .then((setting) => {
                // Make it a password field
                setting.controlEl.querySelector('input')?.setAttribute('type', 'password');
            });

        new Setting(containerEl)
            .setName('Default Space Key (Optional)')
            .setDesc('Fallback if note property doesn\'t specify space')
            .addText(text => text
                .setPlaceholder('MVNx')
                .setValue(this.plugin.settings.defaultSpace || '')
                .onChange(async (value) => {
                    this.plugin.settings.defaultSpace = value;
                    this.plugin.saveSettingsDebounced();
                }));

        // Test Connection Button
        new Setting(containerEl)
            .setName('Test Connection')
            .setDesc('Validate your credentials against the configured Base URL')
            .addButton(button => button
                .setButtonText('Test Connection')
                .onClick(async () => {
                    const url = this.plugin.settings.baseUrl;
                    if (!url) {
                        new Notice('⚠ Please configure the Confluence Base URL before testing.');
                        return;
                    }
                    button.setButtonText('Testing…');
                    button.setDisabled(true);
                    try {
                        const client = new ConfluenceApiClient({
                            baseUrl: url,
                            email: this.plugin.settings.userEmail,
                            apiToken: this.plugin.settings.apiToken
                        });
                        const success = await client.testConnection();
                        if (success) {
                            new Notice('✅ Connection successful!');
                        } else {
                            new Notice('❌ Connection failed. Check the console for details.');
                        }
                    } finally {
                        button.setButtonText('Test Connection');
                        button.setDisabled(false);
                    }
                }));


        new Setting(containerEl)
            .setName('Diagnostics')
            .setHeading();

        new Setting(containerEl)
            .setName('Enable debug logging')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableDebugLogging)
                .onChange(async (value) => {
                    this.plugin.settings.enableDebugLogging = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Cache page IDs')
            .setDesc('Improves performance by caching resolved page IDs for 1 hour. Disable if you frequently move pages in Confluence.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enablePageIdCache)
                .onChange(async (value) => {
                    this.plugin.settings.enablePageIdCache = value;
                    await this.plugin.saveSettings();
                }));
    }
}
