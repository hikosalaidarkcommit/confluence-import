/**
 * Declarative settings API contract (Obsidian 1.13+), fully migrated —
 * the tab has NO display() override.
 *
 * getSettingDefinitions() must expose every user-facing setting (search-
 * discoverable), and getControlValue/setControlValue must read/persist
 * plugin settings with the correct save path (debounced for text,
 * immediate for toggles).
 */
import { ConfluenceSettingsTab } from '../../src/settings';
import { DEFAULT_SETTINGS } from '../../src/models';

type AnyDefinition = {
    name?: string;
    desc?: string;
    type?: string;
    heading?: string;
    items?: AnyDefinition[];
    control?: { type: string; key: string; defaultValue?: unknown };
    action?: () => void;
    render?: (setting: unknown) => void;
};

function makePlugin() {
    return {
        settings: { ...DEFAULT_SETTINGS },
        saveSettings: jest.fn().mockResolvedValue(undefined),
        saveSettingsDebounced: jest.fn(),
    };
}

function makeTab(plugin = makePlugin()): { tab: ConfluenceSettingsTab; plugin: ReturnType<typeof makePlugin> } {
    const app = {} as never;
    return { tab: new ConfluenceSettingsTab(app, plugin as never), plugin };
}

function flatten(defs: AnyDefinition[]): AnyDefinition[] {
    return defs.flatMap(d => (d.items ? d.items : [d]));
}

describe('getSettingDefinitions (fully declarative)', () => {
    const { tab } = makeTab();
    const defs = tab.getSettingDefinitions() as unknown as AnyDefinition[];
    const rows = flatten(defs);

    test('no display() override remains on the subclass', () => {
        expect(Object.prototype.hasOwnProperty.call(
            Object.getPrototypeOf(tab), 'display'
        )).toBe(false);
    });

    test('two groups: Connection and Diagnostics', () => {
        expect(defs.map(d => d.heading)).toEqual(['Connection', 'Diagnostics']);
        expect(defs.every(d => d.type === 'group')).toBe(true);
    });

    test('control keys cover all plain-control settings', () => {
        const keys = rows.map(d => d.control?.key).filter(Boolean).sort();
        expect(keys).toEqual([
            'baseUrl',
            'defaultSpace',
            'enableDebugLogging',
            'enablePageIdCache',
            'userEmail',
        ]);
    });

    test('API token is a render row (masked input) and Test Connection is an action row', () => {
        const tokenRow = rows.find(d => d.name === 'Confluence API Token')!;
        expect(tokenRow.render).toBeInstanceOf(Function);
        expect(tokenRow.control).toBeUndefined();

        const testRow = rows.find(d => d.name === 'Test Connection')!;
        expect(testRow.action).toBeInstanceOf(Function);
        expect(testRow.control).toBeUndefined();
    });

    test('token render row masks the input and saves debounced', () => {
        const { tab, plugin } = makeTab();
        const rows2 = flatten(tab.getSettingDefinitions() as unknown as AnyDefinition[]);
        const tokenRow = rows2.find(d => d.name === 'Confluence API Token')!;

        const attrs: Record<string, string> = {};
        let onChangeCb: ((v: string) => void) | undefined;
        interface FakeTextComponent {
            setPlaceholder(v: string): FakeTextComponent;
            setValue(v: string): FakeTextComponent;
            onChange(cb: (v: string) => void): FakeTextComponent;
            inputEl: { setAttribute(k: string, v: string): void };
        }
        const fakeText: FakeTextComponent = {
            setPlaceholder: () => fakeText,
            setValue: () => fakeText,
            onChange: (cb: (v: string) => void) => {
                onChangeCb = cb;
                return fakeText;
            },
            inputEl: { setAttribute: (k: string, v: string) => { attrs[k] = v; } },
        };
        interface FakeSetting {
            addText(cb: (t: FakeTextComponent) => void): FakeSetting;
        }
        const fakeSetting: FakeSetting = {
            addText: (cb: (t: FakeTextComponent) => void) => { cb(fakeText); return fakeSetting; },
        };

        tokenRow.render!(fakeSetting);

        expect(attrs['type']).toBe('password');
        onChangeCb!('new-token-value');
        expect(plugin.settings.apiToken).toBe('new-token-value');
        expect(plugin.saveSettingsDebounced).toHaveBeenCalled();
    });

    test('toggle defaults mirror DEFAULT_SETTINGS', () => {
        const byKey = new Map(rows.filter(d => d.control).map(d => [d.control!.key, d.control!]));
        expect(byKey.get('enableDebugLogging')!.defaultValue).toBe(DEFAULT_SETTINGS.enableDebugLogging);
        expect(byKey.get('enablePageIdCache')!.defaultValue).toBe(DEFAULT_SETTINGS.enablePageIdCache);
    });

    test('every row has a searchable name and description', () => {
        for (const row of rows) {
            expect((row.name ?? '').length).toBeGreaterThan(0);
            expect((row.desc ?? '').length).toBeGreaterThan(0);
        }
    });
});

describe('getControlValue / setControlValue', () => {
    test('reads current settings values', () => {
        const { tab, plugin } = makeTab();
        plugin.settings.baseUrl = 'https://x.example.com';
        plugin.settings.enablePageIdCache = false;
        expect(tab.getControlValue('baseUrl')).toBe('https://x.example.com');
        expect(tab.getControlValue('enablePageIdCache')).toBe(false);
        expect(tab.getControlValue('nonexistent')).toBeUndefined();
    });

    test('text values persist via the 400ms debounce path', () => {
        const { tab, plugin } = makeTab();
        void tab.setControlValue('userEmail', 'a@b.co');
        expect(plugin.settings.userEmail).toBe('a@b.co');
        expect(plugin.saveSettingsDebounced).toHaveBeenCalledTimes(1);
        expect(plugin.saveSettings).not.toHaveBeenCalled();
    });

    test('baseUrl strips trailing slash on write', () => {
        const { tab, plugin } = makeTab();
        void tab.setControlValue('baseUrl', 'https://host.example.com/');
        expect(plugin.settings.baseUrl).toBe('https://host.example.com');
    });

    test('toggles persist immediately (no debounce)', () => {
        const { tab, plugin } = makeTab();
        void tab.setControlValue('enableDebugLogging', true);
        expect(plugin.settings.enableDebugLogging).toBe(true);
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        expect(plugin.saveSettingsDebounced).not.toHaveBeenCalled();
    });

    test('wrong-typed values are ignored (no write, no save)', () => {
        const { tab, plugin } = makeTab();
        void tab.setControlValue('baseUrl', 123);
        void tab.setControlValue('enableDebugLogging', 'yes');
        expect(plugin.settings.baseUrl).toBe(DEFAULT_SETTINGS.baseUrl);
        expect(plugin.settings.enableDebugLogging).toBe(DEFAULT_SETTINGS.enableDebugLogging);
    });
});
