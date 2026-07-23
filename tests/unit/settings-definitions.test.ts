/**
 * Declarative settings API contract (Obsidian 1.13+).
 *
 * getSettingDefinitions() must expose every user-facing setting so it is
 * discoverable via Obsidian's settings search, with keys that actually
 * exist on ConfluenceSettings (the default getControlValue reads
 * `this.plugin.settings[key]`).
 */
import { ConfluenceSettingsTab } from '../../src/settings';
import { DEFAULT_SETTINGS } from '../../src/models';

type AnyDefinition = {
    name: string;
    desc?: string;
    control?: { type: string; key: string; defaultValue?: unknown };
};

function makeTab(): ConfluenceSettingsTab {
    const app = {} as never;
    const plugin = {
        settings: { ...DEFAULT_SETTINGS },
        saveSettings: jest.fn(),
        saveSettingsDebounced: jest.fn(),
    } as never;
    return new ConfluenceSettingsTab(app, plugin);
}

describe('getSettingDefinitions', () => {
    const defs = makeTab().getSettingDefinitions() as unknown as AnyDefinition[];

    test('returns definitions for all six settings', () => {
        const keys = defs.map(d => d.control?.key).filter(Boolean).sort();
        expect(keys).toEqual([
            'apiToken',
            'baseUrl',
            'defaultSpace',
            'enableDebugLogging',
            'enablePageIdCache',
            'userEmail',
        ]);
    });

    test('every control key exists on ConfluenceSettings', () => {
        const settingsKeys = new Set(Object.keys({ ...DEFAULT_SETTINGS, defaultSpace: '' }));
        for (const def of defs) {
            expect(def.control).toBeDefined();
            expect(settingsKeys.has(def.control!.key)).toBe(true);
        }
    });

    test('control types match the underlying value types', () => {
        const byKey = new Map(defs.map(d => [d.control!.key, d.control!.type]));
        expect(byKey.get('baseUrl')).toBe('text');
        expect(byKey.get('userEmail')).toBe('text');
        expect(byKey.get('apiToken')).toBe('text');
        expect(byKey.get('defaultSpace')).toBe('text');
        expect(byKey.get('enableDebugLogging')).toBe('toggle');
        expect(byKey.get('enablePageIdCache')).toBe('toggle');
    });

    test('toggle defaults mirror DEFAULT_SETTINGS', () => {
        const byKey = new Map(defs.map(d => [d.control!.key, d.control!]));
        expect(byKey.get('enableDebugLogging')!.defaultValue).toBe(DEFAULT_SETTINGS.enableDebugLogging);
        expect(byKey.get('enablePageIdCache')!.defaultValue).toBe(DEFAULT_SETTINGS.enablePageIdCache);
    });

    test('every definition has a searchable name and description', () => {
        for (const def of defs) {
            expect(def.name.length).toBeGreaterThan(0);
            expect((def.desc ?? '').length).toBeGreaterThan(0);
        }
    });
});
