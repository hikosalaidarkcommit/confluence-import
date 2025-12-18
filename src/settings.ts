import { App, PluginSettingTab, Setting, Plugin } from 'obsidian';
import { ConfluenceSettings, DEFAULT_SETTINGS } from './models';
import { ConfluenceApiClient } from './api/confluence-client';

export interface ConfluenceSyncPluginInterface extends Plugin {
    settings: ConfluenceSettings;
    saveSettings(): Promise<void>;
}

export class ConfluenceSettingsTab extends PluginSettingTab {
    plugin: ConfluenceSyncPluginInterface;

    constructor(app: App, plugin: ConfluenceSyncPluginInterface) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();
        containerEl.createEl('h2', { text: 'Confluence Sync Settings' });

        containerEl.createEl('p', {
            text: 'ℹ Base URL will be automatically detected from the confluence-url in your notes.',
            cls: 'setting-item-description'
        });

        new Setting(containerEl)
            .setName('Confluence Base URL')
            .setDesc('Required for on-premise usage or short URLs (e.g., https://confluence.mycompany.com)')
            .addText(text => text
                .setPlaceholder('https://confluence.example.com')
                .setValue(this.plugin.settings.baseUrl)
                .onChange(async (value) => {
                    this.plugin.settings.baseUrl = value.replace(/\/$/, ''); // Remove trailing slash
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Confluence User Email')
            .setDesc('Used for Confluence API authentication')
            .addText(text => text
                .setPlaceholder('user@example.com')
                .setValue(this.plugin.settings.userEmail)
                .onChange(async (value) => {
                    this.plugin.settings.userEmail = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Confluence API Token')
            .setDesc('Generate from: Confluence → Profile → Settings → Personal Access Tokens')
            .addText(text => text
                .setPlaceholder('••••••••••••••••••••••••••••')
                .setValue(this.plugin.settings.apiToken)
                .onChange(async (value) => {
                    this.plugin.settings.apiToken = value;
                    await this.plugin.saveSettings();
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
                    await this.plugin.saveSettings();
                }));

        // Test Connection Button
        new Setting(containerEl)
            .setName('Test Connection')
            .setDesc('Validate your credentials')
            .addButton(button => button
                .setButtonText('Test Connection')
                .onClick(async () => {
                    const url = this.plugin.settings.baseUrl || prompt("Enter your Confluence Base URL to test (e.g. https://your-domain.atlassian.net)");
                    if (url) {
                        const client = new ConfluenceApiClient({
                            baseUrl: url,
                            email: this.plugin.settings.userEmail,
                            apiToken: this.plugin.settings.apiToken
                        });
                        const success = await client.testConnection();
                        if (success) {
                            alert('Connection successful!');
                        } else {
                            alert('Connection failed. Check console for details.');
                        }
                    } else {
                        alert('Base URL is required to test connection.');
                    }
                }));


        containerEl.createEl('h3', { text: 'Advanced Options' });

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
            .setDesc('Improves performance')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enablePageIdCache)
                .onChange(async (value) => {
                    this.plugin.settings.enablePageIdCache = value;
                    await this.plugin.saveSettings();
                }));
    }
}
