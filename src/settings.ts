import { App, PluginSettingTab, Setting, Plugin, Notice, SettingDefinitionItem } from 'obsidian';
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

/** Settings keys whose controls persist immediately (toggles). */
const IMMEDIATE_SAVE_KEYS: ReadonlySet<string> = new Set([
    'enableDebugLogging',
    'enablePageIdCache',
]);

/**
 * Fully declarative settings tab (Obsidian 1.13+).
 *
 * There is deliberately NO `display()` override — the deprecated imperative
 * path is gone. All six settings are defined via `getSettingDefinitions()`,
 * which also makes them discoverable in Obsidian's settings search:
 * - text controls: Base URL, user email, default space key
 * - render row: API token (declarative text controls cannot mark an input
 *   as a password field, so this row renders imperatively INSIDE the
 *   declarative framework to keep masked input)
 * - action row: Test Connection
 * - toggles: debug logging, page ID cache
 *
 * Persistence: text-bearing values save via the plugin's 400 ms debounce;
 * toggles save immediately. Both paths flow through the plugin's existing
 * save pipeline, which also updates the running sync service in place.
 */
export class ConfluenceSettingsTab extends PluginSettingTab {
    plugin: ConfluenceSyncPluginInterface;
    private testingConnection = false;

    constructor(app: App, plugin: ConfluenceSyncPluginInterface) {
        super(app, plugin);
        this.plugin = plugin;
    }

    getControlValue(key: string): unknown {
        switch (key) {
            case 'baseUrl': return this.plugin.settings.baseUrl;
            case 'userEmail': return this.plugin.settings.userEmail;
            case 'apiToken': return this.plugin.settings.apiToken;
            case 'defaultSpace': return this.plugin.settings.defaultSpace ?? '';
            case 'enableDebugLogging': return this.plugin.settings.enableDebugLogging;
            case 'enablePageIdCache': return this.plugin.settings.enablePageIdCache;
            default: return undefined;
        }
    }

    setControlValue(key: string, value: unknown): void {
        switch (key) {
            case 'baseUrl':
                if (typeof value === 'string') {
                    this.plugin.settings.baseUrl = value.replace(/\/$/, '');
                }
                break;
            case 'userEmail':
                if (typeof value === 'string') this.plugin.settings.userEmail = value;
                break;
            case 'apiToken':
                if (typeof value === 'string') this.plugin.settings.apiToken = value;
                break;
            case 'defaultSpace':
                if (typeof value === 'string') this.plugin.settings.defaultSpace = value;
                break;
            case 'enableDebugLogging':
                if (typeof value === 'boolean') this.plugin.settings.enableDebugLogging = value;
                break;
            case 'enablePageIdCache':
                if (typeof value === 'boolean') this.plugin.settings.enablePageIdCache = value;
                break;
            default:
                return;
        }

        if (IMMEDIATE_SAVE_KEYS.has(key)) {
            void this.plugin.saveSettings();
        } else {
            this.plugin.saveSettingsDebounced();
        }
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        return [
            {
                type: 'group',
                heading: 'Connection',
                items: [
                    {
                        name: 'Confluence Base URL',
                        desc: 'Required. For security, credentials are only sent to this host — notes whose confluence-url points elsewhere are rejected.',
                        aliases: ['host', 'server', 'url'],
                        control: {
                            type: 'text',
                            key: 'baseUrl',
                            placeholder: 'https://mycompany.atlassian.net',
                        },
                    },
                    {
                        name: 'Confluence User Email',
                        desc: 'Used for Confluence API authentication.',
                        aliases: ['account', 'login'],
                        control: {
                            type: 'text',
                            key: 'userEmail',
                            placeholder: 'user@example.com',
                        },
                    },
                    {
                        name: 'Confluence API Token',
                        desc: 'Generate from: Confluence → Profile → Settings → Personal Access Tokens. Input is masked.',
                        aliases: ['pat', 'credentials', 'password'],
                        // Declarative text controls cannot render a masked
                        // (password) input, so this row renders imperatively
                        // within the declarative framework.
                        render: (setting: Setting) => {
                            setting.addText(text => {
                                text.setPlaceholder('••••••••••••••••••••••••••••')
                                    .setValue(this.plugin.settings.apiToken)
                                    .onChange((value) => {
                                        this.plugin.settings.apiToken = value;
                                        this.plugin.saveSettingsDebounced();
                                    });
                                text.inputEl.setAttribute('type', 'password');
                            });
                        },
                    },
                    {
                        name: 'Default Space Key',
                        desc: 'Optional fallback if a note property does not specify a space.',
                        aliases: ['space'],
                        control: {
                            type: 'text',
                            key: 'defaultSpace',
                            placeholder: 'SPACE',
                        },
                    },
                    {
                        name: 'Test Connection',
                        desc: 'Validate your credentials against the configured Base URL.',
                        aliases: ['verify', 'check', 'credentials'],
                        action: () => {
                            void this.runConnectionTest();
                        },
                        disabled: () => this.testingConnection,
                    },
                ],
            },
            {
                type: 'group',
                heading: 'Diagnostics',
                items: [
                    {
                        name: 'Enable debug logging',
                        desc: 'Writes a metadata-only debug log (no note or page content) into the plugin folder.',
                        aliases: ['diagnostics', 'log'],
                        control: { type: 'toggle', key: 'enableDebugLogging', defaultValue: false },
                    },
                    {
                        name: 'Cache page IDs',
                        desc: 'Improves performance by caching resolved page IDs for 1 hour. Disable if you frequently move pages in Confluence.',
                        aliases: ['performance', 'resolver'],
                        control: { type: 'toggle', key: 'enablePageIdCache', defaultValue: true },
                    },
                ],
            },
        ];
    }

    /** Shared by the settings action row and the plugin command. */
    async runConnectionTest(): Promise<void> {
        if (this.testingConnection) return;
        const url = this.plugin.settings.baseUrl;
        if (!url) {
            new Notice('⚠ Please configure the Confluence Base URL before testing.');
            return;
        }
        this.testingConnection = true;
        new Notice('Testing Confluence connection…');
        try {
            const client = new ConfluenceApiClient({
                baseUrl: url,
                email: this.plugin.settings.userEmail,
                apiToken: this.plugin.settings.apiToken,
            });
            const success = await client.testConnection();
            if (success) {
                new Notice('✅ Connection successful!');
            } else {
                new Notice('❌ Connection failed. Check the console for details.');
            }
        } finally {
            this.testingConnection = false;
        }
    }
}
